/**
 * PredictFun 体育侧兼容 API（业务名）。
 * 行情总线见 `marketQuoteHub`。
 */

import {
  hasPredictFunQuoteConsumerMarket,
  getPredictFunQuoteConsumerMarketIds,
  onPredictFunMarketHubReady,
  onPredictFunMarketQuote,
  registerPredictFunQuoteMarkets,
  unregisterPredictFunQuoteConsumer,
  type PredictFunMarketQuote,
} from "./marketQuoteHub";

export type PredictFunSportQuote = PredictFunMarketQuote;

const CONSUMER = "sport" as const;

export function getPredictFunSportMarketIds(): string[] {
  return getPredictFunQuoteConsumerMarketIds(CONSUMER);
}

/** @param force transport 重建后强制重订 */
export function setPredictFunSportMarketIds(marketIds: string[], force = false): void {
  registerPredictFunQuoteMarkets(CONSUMER, marketIds, force);
}

export function onPredictFunSportHubBound(fn: () => void): () => void {
  return onPredictFunMarketHubReady(fn);
}

export function onPredictFunSportQuote(fn: (quote: PredictFunSportQuote) => void): () => void {
  return onPredictFunMarketQuote((q) => {
    if (!hasPredictFunQuoteConsumerMarket(CONSUMER, q.marketId))
      return;
    fn(q);
  });
}

export function clearPredictFunSportHub(): void {
  unregisterPredictFunQuoteConsumer(CONSUMER);
}
