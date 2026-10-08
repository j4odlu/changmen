import { normalizePolymarketTickSize } from "./pmTickPrice";
import { pmTickBufferTick } from "./pmTickMetadata";
import { transformPmPrice, type PmPriceQuote } from "./priceQuote";
import { pmBuyOrderShares } from "./pmBuyOrderShares";

export * from "./pmTickMetadata";
export type PmTickBufferQuote = Extract<PmPriceQuote, { mode: "tick" }>;

/** [changmen 扩展] 兼容 tick 调用方；计算只委托纯报价模块。 */
export function createPmTickBufferQuote(tokenId: string, rawAsk: number, tick = pmTickBufferTick(tokenId)): PmTickBufferQuote | undefined {
  const result = transformPmPrice(tokenId, rawAsk, { enabled: true, mode: "tick", multiplier: 1 }, tick);
  return result.status === "ready" && result.quote.mode === "tick" ? result.quote : undefined;
}
export function validatePmTickBufferQuote(value: unknown, tokenId: string, odds: number): PmTickBufferQuote {
  const quote = value as PmTickBufferQuote | undefined;
  let expected: PmTickBufferQuote | undefined;
  try { if (quote) expected = createPmTickBufferQuote(tokenId, quote.rawAsk, normalizePolymarketTickSize(quote.tick)); } catch { /* 校验失败 */ }
  if (!quote || quote.mode !== "tick" || quote.tokenId !== tokenId || !expected
    || quote.cap !== expected.cap || quote.displayOdds !== expected.displayOdds || odds !== quote.displayOdds)
    throw new Error("PM +1 tick 报价缺失或不匹配，请新建投注尝试");
  return quote;
}
/** [changmen 扩展] 旧 tick 调用方兼容；份数编码委托统一 BUY 执行工具。 */
export function pmTickBufferOrderShares(amount: number, quote: PmTickBufferQuote): number {
  return pmBuyOrderShares(amount, quote.cap, quote.tick);
}
