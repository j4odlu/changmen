/** [changmen 扩展] Pure transport identity; no preferences or execution state. */
export function executionAnchors(records) {
  return records.flatMap(row => [
    ...[row.orderId, row.plan.orderHash].filter(Boolean).map(id => ({ player_id: Number(row.plan.playerId), provider: "Polymarket", order_id: String(id).toLowerCase(), executionId: row.id })),
    ...(row.other.orderId ? [{ player_id: Number(row.plan.otherPlayerId), provider: row.plan.otherProvider, order_id: String(row.other.orderId).toLowerCase(), executionId: row.id }] : []),
  ]);
}
const key = (player, provider, id) => JSON.stringify([Number(player), provider, String(id ?? "").toLowerCase()]);
export function partitionClientOrders(rows, records = []) {
  const byId = new Map(executionAnchors(records).map(row => [key(row.player_id, row.provider, row.order_id), row.executionId]));
  for (const row of rows) {
    if (row.PmGtcExecutionId)
      byId.set(key(row.PlayerID, row.Type, row.OrderID), row.PmGtcExecutionId);
  }
  const result = { fok: [], gtc: [] };
  for (const row of rows) {
    const identity = row.PmGtcExecutionId || byId.get(key(row.PlayerID, row.Type, row.OrderID))
      || byId.get(key(row.PlayerID, row.Type, row.PmBuyOrderId ?? row.PfBuyOrderId));
    result[identity ? "gtc" : "fok"].push(identity && !row.PmGtcExecutionId ? { ...row, PmGtcExecutionId: identity } : row);
  }
  return result;
}
