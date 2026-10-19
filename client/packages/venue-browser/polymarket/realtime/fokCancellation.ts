/**
 * [changmen 扩展] 仅由实际 FOK 提交注册的 watch 使用。
 * 官方 FOK 全成或全撤 + CANCELLATION 语义的推论；冲突证据仍交原核验链。
 * https://docs.polymarket.com/concepts/order-lifecycle#order-types
 * https://docs.polymarket.com/trading/realtime-order-updates#understand-order-updates
 */
export function interpretFokCancellation(
  msg: Record<string, unknown>, orderId: string, hasFillEvidence: boolean, hasTradeIds: boolean,
): "unfilled" | null {
  if (String(msg.event_type ?? "").trim().toLowerCase() !== "order"
    || String(msg.type ?? "").trim().toUpperCase() !== "CANCELLATION"
    || String(msg.id ?? "").trim().toLowerCase() !== orderId.trim().toLowerCase()) return null;
  if (hasFillEvidence || hasTradeIds || Number(msg.size_matched) > 0) return null;
  if (msg.order_type != null && String(msg.order_type).trim() !== ""
    && String(msg.order_type).trim().toUpperCase() !== "FOK") return null;
  if (/^(TRADE_STATUS_)?(MATCHED|MINED|CONFIRMED|RETRYING)$/i.test(String(msg.status ?? "").trim())) return null;
  if (msg.associate_trades != null
    && (!Array.isArray(msg.associate_trades) || msg.associate_trades.length > 0)) return null;
  return "unfilled";
}
