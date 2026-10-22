import { Currency, getExchange } from "@changmen/shared/currency";
import { isPmPendingOrder, validatePmSubmission } from "@changmen/shared/pm_submission";

/** [changmen 扩展] 同一订单的 Pending→成交/拒单合并，静态信息始终由订单保管。 */
export function preparePmPendingOrderSave(previous, incoming, playerId, provider) {
  if (provider !== "Polymarket") return incoming;
  const prevRaw = previous?.raw || {};
  const id = String(incoming.orderId || previous?.order_id || "");
  const snapshot = validatePmSubmission(prevRaw.pmSubmission, id, Number(playerId));
  const incomingPending = isPmPendingOrder({ provider, status: incoming.status ?? incoming.Status });
  if (incomingPending && incoming.pmSubmission) {
    const submitted = validatePmSubmission(incoming.pmSubmission, id, Number(playerId));
    if (!submitted) throw new Error("PM 待确认订单提交记录与订单身份不一致");
    if (previous && !isPmPendingOrder(previous)) return null;
    incoming = { ...incoming, pmSubmission: submitted, betMoney: submitted.stakeUsdc * getExchange(Currency.USDT), money: 0, reward: 0 };
    for (const field of ["pmShares", "pmFillPrice", "pmStakeUsdc", "pmFeeUsdc", "pmSellState"])
      delete incoming[field];
  }
  if (!snapshot) return incoming;
  if (Number(prevRaw.pmShares) > 0 && ["reject", "return"].includes(String(incoming.status ?? incoming.Status).toLowerCase()))
    return null;
  if (incomingPending && !isPmPendingOrder(previous)) return null;
  const merged = { ...prevRaw, ...incoming, pmSubmission: snapshot };
  if (Number(incoming.pmShares) > 0 && !incomingPending) {
    delete merged.pmRejectReason;
    delete merged.pmRejectMoneyFixedAt;
  }
  for (const name of ["game", "match", "bet", "item", "pmConditionId", "pmTokenId", "venueMatchId", "venueItemId"]) {
    const stored = prevRaw[name] || previous?.[name];
    if (String(stored ?? "").trim()) merged[name] = stored;
  }
  if (!(Number(incoming.odds) > 0)) merged.odds = Number(previous?.odds || prevRaw.odds) || 0;
  if ((isPmPendingOrder(previous) || ["reject", "return"].includes(String(previous?.status).toLowerCase())) && !incomingPending
    && !["reject", "return"].includes(String(incoming.status ?? incoming.Status).toLowerCase())
    && !(Number(incoming.pmShares) > 0)) return null;
  return merged;
}
