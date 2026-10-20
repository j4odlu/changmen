// [changmen 扩展] Read-only persistence operations; report formatting stays in backend.
import { ensurePgPoolReady, getPgPool } from "./pg_pool.js";
import { financialOrdersRelation } from "./rds/native_orders.js";

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
