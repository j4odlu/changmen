import { normalizePolymarketTickSize, type PolymarketTickSize } from "./pmTickPrice";

/** [changmen 扩展] 按当前 CLOB SDK BUY 金额编码预估份数；两种报价模式共用实际签单限价。 */
export function pmBuyOrderShares(amount: number, limitPrice: number, tick: PolymarketTickSize): number {
  const places = (n: number) => Number.isInteger(n) ? 0 : (String(n).split(".")[1]?.length ?? 0);
  const down = (n: number, d: number) => places(n) <= d ? n : Math.floor(n * 10 ** d) / 10 ** d;
  const up = (n: number, d: number) => places(n) <= d ? n : Math.ceil(n * 10 ** d) / 10 ** d;
  const priceDecimals = normalizePolymarketTickSize(tick).split(".")[1]!.length;
  const decimals = priceDecimals + 2;
  let shares = down(amount, 2) / down(limitPrice, priceDecimals);
  if (places(shares) > decimals) {
    shares = up(shares, decimals + 4);
    if (places(shares) > decimals) shares = down(shares, decimals);
  }
  return shares;
}
