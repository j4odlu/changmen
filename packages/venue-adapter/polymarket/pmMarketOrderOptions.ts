import { normalizePolymarketTickSize } from "./pmTickPrice";

/** [changmen 扩展] BUY/SELL 共用同一盘口资产和签名域校验。 */
export function polymarketMarketOrderOptions(book: {
  asset_id?: string; version?: string; neg_risk?: boolean;
  min_order_size?: string | number; tick_size?: string | number;
  minimum_tick_size?: string | number;
} | null | undefined, tokenId: string) {
  if (!book || String(book.asset_id) !== tokenId
    || !["string", "number"].includes(typeof book.min_order_size)
    || !Number.isFinite(Number(book.min_order_size)) || Number(book.min_order_size) <= 0
    || typeof book.neg_risk !== "boolean" || (book.version !== undefined && book.version !== "v2"))
    throw new Error("PM 订单簿结构、资产或版本无效");
  return {
    version: book.version === "v2" ? 3 as const : 2 as const,
    tickSize: normalizePolymarketTickSize(book.tick_size ?? book.minimum_tick_size),
    minOrderSize: Number(book.min_order_size), negRisk: book.neg_risk,
  };
}
