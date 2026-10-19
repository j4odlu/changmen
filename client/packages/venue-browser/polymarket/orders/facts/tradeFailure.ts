import type { PolymarketOrderRow } from "./orderTypes";

/** [changmen 扩展] 当前 BUY FOK 的唯一 taker trade 永久失败，作为官方拒单依据。 */
export function polymarketFailedBuyTradeRow(
  trade: { id?: unknown; status?: unknown; side?: unknown; taker_order_id?: unknown },
  orderId: string,
  knownTradeIds: Iterable<string> = [],
): PolymarketOrderRow | null {
  const id = String(trade.id ?? "").trim();
  const target = orderId.trim().toLowerCase();
  if (!target || !id || !/^(TRADE_STATUS_)?FAILED$/i.test(String(trade.status ?? "").trim())
    || String(trade.side ?? "").trim().toUpperCase() !== "BUY"
    || String(trade.taker_order_id ?? "").trim().toLowerCase() !== target)
    return null;
  const ids = new Set([...knownTradeIds, id].map(value => value.trim().toLowerCase()).filter(Boolean));
  if (ids.size !== 1)
    return null;
  return { id: orderId, status: String(trade.status), size_matched: "0",
    associate_trades: [id], confirmationBasis: "trade_failed" };
}

export function isPolymarketTradeFailureRow(row: PolymarketOrderRow | null | undefined): boolean {
  return row?.confirmationBasis === "trade_failed"
    && /^(TRADE_STATUS_)?FAILED$/i.test(String(row.status ?? "").trim())
    && row.associate_trades?.length === 1;
}
