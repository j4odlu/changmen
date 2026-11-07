import { truncateOddsTo3 } from "@changmen/shared/odds_format";
import type { PmPriceQuoteResult } from "@changmen/venue-browser/polymarket/priceQuote";
import type { PolymarketMarketFeeDetails } from "@changmen/venue-browser/polymarket/orders/pmFee";

/** [changmen 扩展] 只读同档未截断价格；列表 fallback 也使用其原始赔率，不反推已截断的显示文本。 */
export function pmFeeDisplayPrice(displayOdds: number, quote?: PmPriceQuoteResult, fallbackOdds = 0): number | undefined {
  if (!(displayOdds > 1)) return undefined;
  if (quote) return quote.status === "ready" && quote.quote.displayOdds === displayOdds ? quote.quote.cap : undefined;
  return fallbackOdds > 1 && truncateOddsTo3(fallbackOdds) === displayOdds ? 1 / fallbackOdds : undefined;
}

/** [changmen 扩展] 单位份额含费成本的倒数；不按单份先舍入手续费，避免把小数误差放大到整笔订单。 */
export function pmFeeAdjustedOdds(price: number | undefined, fee: PolymarketMarketFeeDetails | undefined): string | undefined {
  if (price == null || !Number.isFinite(price) || !(price > 0 && price < 1)
    || !fee || fee.exponent !== 1 || !Number.isFinite(fee.feeRate) || fee.feeRate < 0) return undefined;
  const cost = price + fee.feeRate * price * (1 - price);
  return truncateOddsTo3(1 / cost).toFixed(3);
}
