import { sqlOrderBelongsToRange } from "../../order_link_filter.js";
import { getPgPool } from "../common.js";
import { localDayBounds } from "../time_bounds.js";

/** Read persisted routing metadata without starting GTC or creating its schema. */
export async function fetchOrderExecutionIdentities(owner, { strict = false } = {}) {
  const pool = getPgPool();
  if (!pool || !owner)
    return [];
  try {
    const result = await pool.query("SELECT record FROM pm_gtc_executions WHERE owner=$1", [String(owner)]);
    return (result.rows ?? []).map(row => row.record);
  }
  catch (error) {
    if (strict && error.code !== "42P01")
      throw error;
    return [];
  }
}

/** [changmen 扩展] Filter identity before pagination. Neither mode consumes the other's page slots. */
export async function fetchOrdersByExecutionPage(date, owner, mode, anchors, pageIndex = 1, pageSize = 1024) {
  const pool = getPgPool();
  if (!pool || !owner)
    return { rows: [], total: 0 };
  const { dayStart, dayEnd } = localDayBounds(date);
  const size = Math.max(1, Math.min(Number(pageSize) || 1024, 5000));
  const page = Math.max(1, Number(pageIndex) || 1);
  const match = `(NULLIF(raw->>'pmGtcExecutionId','') IS NOT NULL
    OR EXISTS (SELECT 1 FROM jsonb_to_recordset($5::jsonb)
      AS identity(player_id bigint, provider text, order_id text)
      WHERE identity.player_id=orders.player_id AND identity.provider=orders.provider
        AND (identity.order_id=LOWER(orders.order_id)
          OR identity.order_id=LOWER(COALESCE(orders.raw->>'pmBuyOrderId',orders.raw->>'pfBuyOrderId',''))))
    OR EXISTS (SELECT 1 FROM orders parent WHERE parent.user_id=orders.user_id
      AND parent.player_id=orders.player_id AND parent.provider=orders.provider
      AND LOWER(parent.order_id)=LOWER(COALESCE(orders.raw->>'pmBuyOrderId',orders.raw->>'pfBuyOrderId',''))
      AND NULLIF(parent.raw->>'pmGtcExecutionId','') IS NOT NULL))`;
  const predicate = `user_id=$1 AND ${sqlOrderBelongsToRange(2, 3)} AND (${match})=$4::boolean`;
  const params = [String(owner), dayStart, dayEnd, mode === "GTC", JSON.stringify(anchors)];
  const count = await pool.query(`SELECT COUNT(*)::int AS n FROM orders WHERE ${predicate}`, params);
  const result = await pool.query(`SELECT * FROM orders WHERE ${predicate} ORDER BY create_at DESC LIMIT $6 OFFSET $7`, [...params, size, (page - 1) * size]);
  return { rows: result.rows ?? [], total: count.rows[0]?.n ?? 0 };
}
