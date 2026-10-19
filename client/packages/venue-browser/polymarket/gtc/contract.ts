import type { PolymarketTickSize } from "../pmTickPrice";
import type { PmPriceQuote } from "../priceQuote";
/** [changmen 扩展] GTC owns its preparation contract and cache. */
export interface GtcBuyCheckData extends Record<string, unknown> {
  pmPriceQuote?: PmPriceQuote;
  tokenId: string;
  odds: number;
  detectionOdds: number;
  detectionMaxPrice: number;
  detectionClobPrice?: number;
  bookPrice: number;
  limitPrice: number;
  betMoney: number;
  apiBetMoney: number;
  side: "BUY";
  bookFetchedAt: number;
  orderOptions: { version: 2 | 3; bookTimestamp: number; tickSize: PolymarketTickSize; minOrderSize: number; negRisk: boolean; asks: Array<{ price: number; size: number }> };
}
