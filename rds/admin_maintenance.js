// [changmen 扩展] Read-only persistence operations; report formatting stays in backend.
import { ensurePgPoolReady, getPgPool } from "./pg_pool.js";
import { financialOrdersRelation } from "./rds/native_orders.js";

/** Historical PM audit only. Caller owns the dedicated connection; never writes order data. */
export async function readPolymarketHistoryAuditSnapshot(client) {
  if (typeof client?.query !== "function") throw new TypeError("A dedicated audit client is required");
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    await client.query("SET LOCAL statement_timeout = '20s'");
    await client.query("SET LOCAL lock_timeout = '2s'");
    const { rows: [session] } = await client.query(
      "SELECT current_setting('transaction_read_only') AS read_only, transaction_timestamp() AS captured_at",
    );
    if (session?.read_only !== "on") throw new Error("History audit requires a read-only transaction");
    const { rows } = await client.query(`
      SELECT id, player_id, order_id, link, provider, match, bet, item, odds,
             bet_money, money, status, create_at, raw,
             raw->>'pmTokenId' AS token_id_text,
             raw->>'pmConditionId' AS condition_id_text,
             jsonb_typeof(raw->'pmTokenId') AS token_id_json_type
      FROM ${financialOrdersRelation()}
      WHERE provider = 'Polymarket'
      ORDER BY id
    `);
    const executionIds = [...new Set(rows.map(row => row.raw?.pmGtcExecutionId).filter(id => typeof id === "string" && id))];
    // A missing execution table is legitimate before the first GTC use.
    const { rows: [gtcTable] } = await client.query("SELECT to_regclass('pm_gtc_executions') AS relation");
    const gtcRows = executionIds.length && gtcTable?.relation
      ? (await client.query("SELECT id::text AS id, active, updated_at, record FROM pm_gtc_executions WHERE id::text = ANY($1::text[]) ORDER BY id", [executionIds])).rows
      : [];
    const counterpartRows = gtcRows.length
      ? (await client.query(`SELECT o.id, o.player_id, o.order_id, o.provider, o.link, o.status,
          o.bet_money, o.money, o.create_at, e.id::text AS execution_id
        FROM ${financialOrdersRelation("o")}
        JOIN pm_gtc_executions e ON o.user_id = e.owner
          AND o.player_id::text = e.record->'plan'->>'otherPlayerId'
          AND LOWER(o.order_id) = LOWER(e.record->'other'->>'orderId')
        WHERE e.id::text = ANY($1::text[]) ORDER BY o.id`, [gtcRows.map(row => row.id)])).rows
      : [];
    return { readOnly: true, capturedAt: session.captured_at, rows, gtcRows, counterpartRows };
  }
  finally {
    await client.query("ROLLBACK");
  }
}

export async function readSharedVenueAccountRows() {
  await ensurePgPoolReady();
  const pool = getPgPool();
  if (!pool)
    throw new Error("数据库未就绪");

  const { rows } = await pool.query(`
    WITH multi AS (
      SELECT venue_account_key
      FROM players
      WHERE venue_account_key <> ''
      GROUP BY venue_account_key
      HAVING COUNT(DISTINCT owner_user_id) > 1
    )
    SELECT
      p.venue_account_key AS key,
      p.provider,
      p.venue_member_id,
      p.id AS player_id,
      pr.user_name,
      p.owner_user_id::text AS user_id,
      p.platform_name,
      p.player_name,
      COALESCE(p.account_data->>'venueAccountName', '') AS venue_account_name,
      (p.deleted_at IS NOT NULL) AS deleted,
      p.created_at,
      p.deleted_at,
      (SELECT COUNT(*)::int FROM ${financialOrdersRelation("o")} WHERE o.player_id = p.id) AS order_count
    FROM players p
    JOIN profiles pr ON pr.id = p.owner_user_id
    JOIN multi m ON m.venue_account_key = p.venue_account_key
    ORDER BY p.venue_account_key, p.deleted_at NULLS FIRST, pr.user_name, p.id
  `);
  return rows;
}

export async function readDuplicateOrderRows() {
  await ensurePgPoolReady();
  const pool = getPgPool();
  if (!pool)
    throw new Error("数据库未就绪");

  const sameUser = await pool.query(`
    SELECT lower(o.order_id) AS oid,
           o.user_id::text AS user_id,
           pr.user_name,
           COUNT(*)::int AS n,
           array_agg(o.id ORDER BY o.id) AS ids,
           array_agg(o.player_id::text ORDER BY o.id) AS player_ids,
           array_agg(o.provider ORDER BY o.id) AS providers,
           array_agg(o.status ORDER BY o.id) AS statuses,
           array_agg(o.money ORDER BY o.id) AS moneys,
           MIN(o.create_at) AS min_at,
           MAX(o.create_at) AS max_at
    FROM ${financialOrdersRelation("o")}
    LEFT JOIN profiles pr ON pr.id = o.user_id
    WHERE o.order_id IS NOT NULL AND trim(o.order_id) <> ''
    GROUP BY lower(o.order_id), o.user_id, pr.user_name
    HAVING COUNT(*) > 1
    ORDER BY MAX(o.create_at) DESC
    LIMIT 500
  `);

  const crossUser = await pool.query(`
    SELECT lower(o.order_id) AS oid,
           COUNT(*)::int AS n,
           COUNT(DISTINCT o.user_id)::int AS user_n,
           array_agg(DISTINCT pr.user_name ORDER BY pr.user_name) AS names,
           array_agg(o.id ORDER BY o.id) AS ids,
           array_agg(o.user_id::text ORDER BY o.id) AS user_ids,
           array_agg(pr.user_name ORDER BY o.id) AS user_names,
           array_agg(o.player_id::text ORDER BY o.id) AS player_ids,
           array_agg(o.provider ORDER BY o.id) AS providers,
           array_agg(o.status ORDER BY o.id) AS statuses,
           array_agg(o.money ORDER BY o.id) AS moneys,
           MIN(o.create_at) AS min_at,
           MAX(o.create_at) AS max_at
    FROM ${financialOrdersRelation("o")}
    LEFT JOIN profiles pr ON pr.id = o.user_id
    WHERE o.order_id IS NOT NULL AND trim(o.order_id) <> ''
    GROUP BY lower(o.order_id)
    HAVING COUNT(DISTINCT o.user_id) > 1
    ORDER BY MAX(o.create_at) DESC
    LIMIT 500
  `);
  return { sameUser, crossUser };
}
