/** [changmen 扩展] 新 GTC 的卖出/结算只锁已确认订单，不依赖执行表。 */
export async function readGtcResultIdentity(client, row) {
  if (row.provider !== "Polymarket") return false;
  const parent = String(row.raw.pmBuyOrderId ?? row.order_id).toLowerCase();
  const found = await client.query(`SELECT provider,raw FROM orders WHERE user_id=$1 AND player_id=$2
    AND lower(order_id)=lower($3) FOR UPDATE`, [row.user_id, row.player_id, parent]);
  const canonical = found.rows[0];
  if (canonical?.raw?.pmGtcResultRevision == null) return false;
  if (canonical.provider !== "Polymarket" || canonical.raw.pmSide === "sell"
    || canonical.raw.pmGtcExecutionId !== row.raw.pmGtcExecutionId)
    throw new Error("GTC 原单确认结果身份不一致");
  return true;
}
