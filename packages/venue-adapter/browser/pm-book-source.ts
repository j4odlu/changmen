import { observePmMarketStream } from "../polymarket/realtime/marketStream";
import { getPolymarketQuoteConsumerAssetIds } from "../polymarket/quotes/marketQuoteHub";
import type { ReadonlyMarketSourcePort } from "@changmen/pm-market-data-browser";

/** [changmen 扩展] Existing observations only; no Worker factory or subscription authority. */
export const pmOrderBookSource: ReadonlyMarketSourcePort = Object.freeze({
  observe: observePmMarketStream,
  subscribedAssets: () => getPolymarketQuoteConsumerAssetIds("esport"),
});
