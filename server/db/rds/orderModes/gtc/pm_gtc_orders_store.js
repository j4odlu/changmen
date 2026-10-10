/** [changmen 扩展] GTC 原单专用保存。旧 FOK upsert SQL/事务独立保留。 */
import { _jsonb, getPgPool } from "../../common.js";

const UPSERT_ORDERS_BATCH_SQL = `
  INSERT INTO orders (
    user_id, player_id, order_id, link, provider, match, bet, item,
    odds, bet_money, money, status, create_at, raw
  )
  SELECT * FROM unnest(
    $1::uuid[],
    $2::bigint[],
    $3::text[],
    $4::bigint[],
    $5::text[],
    $6::text[],
    $7::text[],
    $8::text[],
    $9::float8[],
    $10::float8[],
    $11::float8[],
    $12::text[],
    $13::bigint[],
    $14::jsonb[]
  ) AS t(
    user_id, player_id, order_id, link, provider, match, bet, item,
    odds, bet_money, money, status, create_at, raw
  )
  WHERE NOT EXISTS (SELECT 1 FROM orders canonical
    WHERE canonical.user_id=t.user_id AND canonical.order_id=t.order_id
      AND canonical.provider='Polymarket' AND t.provider='Polymarket'
      AND canonical.player_id<>t.player_id AND canonical.raw->>'pmGtcExecutionId' IS NOT NULL)
    AND (t.provider <> 'Polymarket' OR LOWER(COALESCE(t.raw->>'pmSide','')) = 'sell'
      OR EXISTS (SELECT 1 FROM orders canonical WHERE canonical.user_id=t.user_id
        AND canonical.player_id=t.player_id AND canonical.order_id=t.order_id
        AND canonical.raw->>'pmGtcExecutionId'=t.raw->>'pmGtcExecutionId'))
  ON CONFLICT (user_id, order_id, player_id) DO UPDATE SET
    link = CASE WHEN (orders.provider='Polymarket' AND LOWER(COALESCE(orders.raw->>'pmSide',''))<>'sell' AND orders.raw->>'pmGtcExecutionId' IS NOT NULL) THEN orders.link ELSE EXCLUDED.link END,
    provider = CASE WHEN (orders.provider='Polymarket' AND LOWER(COALESCE(orders.raw->>'pmSide',''))<>'sell' AND orders.raw->>'pmGtcExecutionId' IS NOT NULL) THEN orders.provider ELSE EXCLUDED.provider END,
    match = EXCLUDED.match,
    bet = EXCLUDED.bet,
    item = EXCLUDED.item,
    odds = CASE WHEN (orders.provider='Polymarket' AND LOWER(COALESCE(orders.raw->>'pmSide',''))<>'sell' AND orders.raw->>'pmGtcExecutionId' IS NOT NULL) THEN orders.odds ELSE EXCLUDED.odds END,
    bet_money = CASE WHEN (orders.provider='Polymarket' AND LOWER(COALESCE(orders.raw->>'pmSide',''))<>'sell' AND orders.raw->>'pmGtcExecutionId' IS NOT NULL) THEN orders.bet_money ELSE EXCLUDED.bet_money END,
    money = EXCLUDED.money,
    status = EXCLUDED.status,
    create_at = EXCLUDED.create_at,
    raw = CASE WHEN NOT (orders.provider='Polymarket' AND LOWER(COALESCE(orders.raw->>'pmSide',''))<>'sell' AND orders.raw->>'pmGtcExecutionId' IS NOT NULL) THEN EXCLUDED.raw ELSE
      (EXCLUDED.raw - 'pmRejectReason' - 'pmRejectMoneyFixedAt') || jsonb_build_object(
        'pmGtcExecutionId', orders.raw->'pmGtcExecutionId', 'pmGtcRevision', orders.raw->'pmGtcRevision',
        'pmGtcBuyShares', orders.raw->'pmGtcBuyShares', 'pmGtcBuyCost', orders.raw->'pmGtcBuyCost',
        'betMoney', orders.bet_money,
        'pmFillPrice', orders.raw->'pmFillPrice', 'pmFeeUsdc', orders.raw->'pmFeeUsdc',
        'pmOrigin', 'changmen', 'pmSide', 'buy',
        'pmShares', (orders.raw->>'pmGtcBuyShares')::float8,
        'pmAttributedSellShares', greatest(COALESCE((orders.raw->>'pmAttributedSellShares')::float8,0),COALESCE((EXCLUDED.raw->>'pmAttributedSellShares')::float8,0)),
        'pmSellProceeds', greatest(COALESCE((orders.raw->>'pmSellProceeds')::float8,0),COALESCE((EXCLUDED.raw->>'pmSellProceeds')::float8,0)),
        'pmRealizedPnlUsdc', (CASE WHEN COALESCE((EXCLUDED.raw->>'pmAttributedSellShares')::float8,0)>=COALESCE((orders.raw->>'pmAttributedSellShares')::float8,0) THEN COALESCE((EXCLUDED.raw->>'pmRealizedPnlUsdc')::float8,(orders.raw->>'pmRealizedPnlUsdc')::float8,0) ELSE COALESCE((orders.raw->>'pmRealizedPnlUsdc')::float8,0) END),
        'pmStakeUsdc', greatest(0,COALESCE((orders.raw->>'pmGtcBuyCost')::float8,0)-greatest(COALESCE((orders.raw->>'pmSellProceeds')::float8,0),COALESCE((EXCLUDED.raw->>'pmSellProceeds')::float8,0))+(CASE WHEN COALESCE((EXCLUDED.raw->>'pmAttributedSellShares')::float8,0)>=COALESCE((orders.raw->>'pmAttributedSellShares')::float8,0) THEN COALESCE((EXCLUDED.raw->>'pmRealizedPnlUsdc')::float8,(orders.raw->>'pmRealizedPnlUsdc')::float8,0) ELSE COALESCE((orders.raw->>'pmRealizedPnlUsdc')::float8,0) END)))
      END
  RETURNING *, (xmax = 0) AS was_inserted
`;

function _orderRowToUpsertArrays(rows) {
  const userIds = [];
  const playerIds = [];
  const orderIds = [];
  const links = [];
  const providers = [];
  const matches = [];
  const bets = [];
  const items = [];
  const oddsList = [];
  const betMoneys = [];
  const moneys = [];
  const statuses = [];
  const createAts = [];
  const raws = [];
  for (const o of rows) {
    userIds.push(String(o.user_id));
    playerIds.push(Number(o.player_id));
    orderIds.push(String(o.order_id));
    links.push(o.link != null ? Number(o.link) : null);
    providers.push(o.provider != null ? String(o.provider) : null);
    matches.push(o.match != null ? String(o.match) : null);
    bets.push(o.bet != null ? String(o.bet) : null);
    items.push(o.item != null ? String(o.item) : null);
    oddsList.push(Number(o.odds) || 0);
    betMoneys.push(Number(o.bet_money) || 0);
    moneys.push(Number(o.money) || 0);
    statuses.push(String(o.status || "None"));
    createAts.push(Number(o.create_at));
    raws.push(JSON.parse(_jsonb(o.raw, {})));
  }
  return [
    userIds,
    playerIds,
    orderIds,
    links,
    providers,
    matches,
    bets,
    items,
    oddsList,
    betMoneys,
    moneys,
    statuses,
    createAts,
    raws,
  ];
}

function _dedupeUpsertRows(rows) {
  const byKey = new Map();
  for (const row of rows) {
    const key = `${row.user_id}\0${row.player_id}\0${row.order_id}`;
    byKey.set(key, row);
  }
  return [...byKey.values()];
}

async function _rdsUpsertOrders(pool, rows) {
  if (!rows?.length)
    return [];
  const deduped = _dedupeUpsertRows(rows);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // 只有 GTC 分支查询执行记录；FOK 不增加查询或等待。
    for (const row of deduped) {
      const found = await client.query("SELECT record FROM pm_gtc_executions WHERE id=$1 AND owner=$2 FOR SHARE", [row.raw.pmGtcExecutionId, row.user_id]);
      const execution = found.rows[0]?.record;
      const parentId = String(row.raw.pmBuyOrderId ?? row.raw.pfBuyOrderId ?? row.order_id).toLowerCase();
      const pm = execution && row.provider === "Polymarket" && Number(row.player_id) === Number(execution.plan.playerId)
        && [execution.orderId, execution.plan.orderHash].filter(Boolean).some(id => String(id).toLowerCase() === parentId);
      const other = execution && row.provider === execution.plan.otherProvider && Number(row.player_id) === Number(execution.plan.otherPlayerId)
        && execution.other.state !== "not_attempted"
        && (!execution.other.orderId || String(execution.other.orderId).toLowerCase() === parentId);
      if (!pm && !other)
        throw new Error("GTC 原单执行身份不一致");
    }
    const res = await client.query(UPSERT_ORDERS_BATCH_SQL, _orderRowToUpsertArrays(deduped));
    await client.query("COMMIT");
    const inserted = [];
    for (const row of res.rows || []) {
      if (row?.was_inserted) {
        const { was_inserted: _wi, ...clean } = row;
        inserted.push(clean);
      }
    }
    return inserted;
  }
  catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
  finally {
    client.release();
  }
}

export async function upsertPmGtcOrders(rows) {
  if (!rows?.length)
    return false;
  const pool = getPgPool();
  if (!pool)
    return false;
  try {
    await _rdsUpsertOrders(pool, rows);
    return true;
  }
  catch (error) {
    console.warn("[rds] upsertPmGtcOrders:", error.message);
    return false;
  }
}
