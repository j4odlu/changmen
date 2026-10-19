import { truncateOddsTo3 } from "@changmen/shared/odds_format";
import { isPolymarketPriceOnTick, normalizePolymarketTickSize, type PolymarketTickSize } from "./pmTickPrice";

/** [changmen 扩展] 纯报价转换：不读行情缓存、配置或时钟，不请求网络。 */
export interface PmPricePolicy {
  enabled: boolean;
  mode?: "percent" | "tick";
  multiplier: number;
}
interface QuoteBase {
  tokenId: string;
  rawAsk: number;
  cap: number;
  displayOdds: number;
}
export type PmPriceQuote = Readonly<QuoteBase & (
  | { mode: "none" }
  | { mode: "percent"; multiplier: number }
  | { mode: "tick"; tick: PolymarketTickSize }
)>;
export type PmPriceQuoteResult =
  | { status: "ready"; quote: PmPriceQuote }
  | { status: "locked" | "waiting-tick" | "invalid-price" };

export function transformPmPrice(
  tokenId: string,
  rawAsk: number,
  policy: PmPricePolicy,
  tick?: PolymarketTickSize,
): PmPriceQuoteResult {
  if (!Number.isFinite(rawAsk) || rawAsk <= 0 || rawAsk >= 1)
    return { status: "invalid-price" };
  let cap = rawAsk;
  let mode: PmPriceQuote["mode"] = "none";
  if (policy.enabled && policy.mode === "tick") {
    if (!tick) return { status: "waiting-tick" };
    try { tick = normalizePolymarketTickSize(tick); }
    catch { return { status: "invalid-price" }; }
    if (!isPolymarketPriceOnTick(rawAsk, tick)) return { status: "invalid-price" };
    mode = "tick";
    cap = (Math.round(rawAsk * 10_000) + Math.round(Number(tick) * 10_000)) / 10_000;
    if (!isPolymarketPriceOnTick(cap, tick)) return { status: "invalid-price" };
  }
  else if (policy.enabled && policy.multiplier > 1) {
    if (!Number.isFinite(policy.multiplier)) return { status: "invalid-price" };
    mode = "percent";
    cap = Math.min(0.9999, Math.round(rawAsk * policy.multiplier * 10_000) / 10_000);
  }
  const displayOdds = truncateOddsTo3(1 / cap);
  if (mode === "tick" && !(displayOdds > 1)) return { status: "invalid-price" };
  const base = { tokenId, rawAsk, cap, displayOdds };
  const quote: PmPriceQuote = mode === "tick"
    ? Object.freeze({ ...base, mode, tick: tick! })
    : mode === "percent"
      ? Object.freeze({ ...base, mode, multiplier: policy.multiplier })
      : Object.freeze({ ...base, mode });
  return { status: "ready", quote };
}

export function validatePmPriceQuote(value: unknown, tokenId: string, odds: number): PmPriceQuote {
  const quote = value as PmPriceQuote | undefined;
  if (!quote || !["none", "percent", "tick"].includes(quote.mode))
    throw new Error("PM 调整报价缺失或不匹配，请新建投注尝试");
  const result = transformPmPrice(tokenId, quote.rawAsk, {
    enabled: quote.mode !== "none",
    mode: quote.mode === "tick" ? "tick" : "percent",
    multiplier: quote.mode === "percent" ? quote.multiplier : 1,
  }, quote.mode === "tick" ? quote.tick : undefined);
  if (quote.tokenId !== tokenId || result.status !== "ready"
    || result.quote.mode !== quote.mode || result.quote.cap !== quote.cap
    || result.quote.displayOdds !== quote.displayOdds || odds !== quote.displayOdds)
    throw new Error("PM 调整报价缺失或不匹配，请新建投注尝试");
  return quote;
}
