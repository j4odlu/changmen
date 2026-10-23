import type { BetOption } from "@changmen/client-core/models/betOption";
import { capturePmPriceQuote as capturePmQuote } from "@/domain/polymarket/tickBufferQuote";
import { attachPolymarketDetectionQuote as attachPmQuote } from "@/domain/polymarket/attachDetectionQuote";
import { buildPolymarketArbProgressMeta as buildPmMeta } from "@/domain/polymarket/arbProgressPmMeta";
import { storeQuoteSource } from "./quoteSource";

export function capturePmPriceQuote(option: BetOption): void {
  capturePmQuote(option, storeQuoteSource);
}
export const capturePmTickBufferQuote = capturePmPriceQuote;

export function attachPolymarketDetectionQuote(option: BetOption, scope: "esport" | "sport" = "esport"): void {
  attachPmQuote(option, storeQuoteSource, scope);
}

export function buildPolymarketArbProgressMeta(option: BetOption) {
  return buildPmMeta(option, storeQuoteSource);
}
