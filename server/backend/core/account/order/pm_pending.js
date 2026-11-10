import { Currency, getExchange } from "@changmen/shared/currency";
import { isPmPendingOrder, validatePmSubmission } from "@changmen/shared/pm_submission";
import { polymarketConditionsAgree } from "@changmen/shared/pm_market_assets";

/** [changmen 扩展] 同一订单的 Pending→成交/拒单合并，保留身份，允许同资产的原生盘口名纠正旧标签。 */
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
    // [changmen 扩展] 待确认旧单曾保存合场决胜局名称；不能让它永久压过 PM 后续查到的全场盘。
    // 只接受原生标签和完整的同市场/同 token 身份，拒单说明、空值及其它资产不能改名。
    if (name === "bet" && /^(?:全场|地图[1-9]\d*)$/.test(String(incoming.bet ?? ""))
      && String(prevRaw.pmTokenId ?? "").trim() && prevRaw.pmTokenId === incoming.pmTokenId
      && String(prevRaw.pmConditionId ?? "").trim() && String(incoming.pmConditionId ?? "").trim()
      && polymarketConditionsAgree(prevRaw.pmConditionId, incoming.pmConditionId))
      continue;
    const stored = prevRaw[name] || previous?.[name];
    if (String(stored ?? "").trim()) merged[name] = stored;
  }
  if (!(Number(incoming.odds) > 0)) merged.odds = Number(previous?.odds || prevRaw.odds) || 0;
  if ((isPmPendingOrder(previous) || ["reject", "return"].includes(String(previous?.status).toLowerCase())) && !incomingPending
    && !["reject", "return"].includes(String(incoming.status ?? incoming.Status).toLowerCase())
    && !(Number(incoming.pmShares) > 0)) return null;
  return merged;
}
