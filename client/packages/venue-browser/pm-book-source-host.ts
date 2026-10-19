import { observePmMarketStream } from "./polymarket/marketStream";
import { getPolymarketQuoteConsumerAssetIds } from "./polymarket/marketQuoteHub";
import { createReadonlyMarketSource } from "./pm-book-source";

/** [changmen 扩展] One source per module; existing observations only, with no subscription authority. */
export const pmOrderBookSource = createReadonlyMarketSource(
  observePmMarketStream,
  () => getPolymarketQuoteConsumerAssetIds("esport"),
);
