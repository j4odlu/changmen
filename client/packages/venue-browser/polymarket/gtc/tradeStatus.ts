const GTC_TRADE_STATUSES = ["MATCHED", "MINED", "CONFIRMED", "RETRYING", "FAILED"] as const;
type GtcTradeStatus = typeof GTC_TRADE_STATUSES[number];

/** [changmen 扩展] REST / 用户流的已知成交状态统一为内部形式；订单状态不走此转换。
 * https://docs.polymarket.com/api-reference/trade/get-trades
 * https://docs.polymarket.com/trading/realtime-order-updates
 */
export function normalizeGtcTradeStatus(value: unknown): GtcTradeStatus | undefined {
  if (typeof value !== "string") return undefined;
  const status = value.trim().toUpperCase().replace(/^TRADE_STATUS_/, "");
  // 已撮合但尚未广播仍是中间态，不能作为最终成交确认。
  if (status === "MATCHED_NOT_BROADCASTED") return "MATCHED";
  return GTC_TRADE_STATUSES.find(known => known === status);
}
