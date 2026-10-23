import type { BetOption } from "@changmen/client-core/models/betOption";
import { attachPredictFunDetectionQuote as attachPfQuote } from "@/domain/predictfun/attachDetectionQuote";
import { storeQuoteSource } from "./quoteSource";

export function attachPredictFunDetectionQuote(option: BetOption): void {
  attachPfQuote(option, storeQuoteSource);
}
