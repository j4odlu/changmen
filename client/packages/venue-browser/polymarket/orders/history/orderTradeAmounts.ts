/** 官方成交金额与份额转换；所有函数仅依赖输入数值。 */
import { polymarketDecimalAmount, polymarketBaseUnitAmount } from "@changmen/shared/pm_amounts";
import type { PolymarketTradeRow } from "./orderTradeTypes";

/** GET /data/trades.size、maker_orders.matched_amount 均按归一化份数计算。 */
export function polymarketBuyStakeUsdc(sizeRaw: string | number | undefined, price: number): number {
  const shares = polymarketShareCount(sizeRaw);
  if (shares <= 0 || !Number.isFinite(price) || price <= 0)
    return 0;
  return shares * price;
}

/** GET 成交份数和 order.size_matched 已归一化；大额订单也不能再次缩放。 */
export function polymarketShareCount(sizeRaw: string | number | undefined): number {
  return Math.max(0, polymarketDecimalAmount(sizeRaw));
}

/** 原始 POST 回执金额 → USDC；固定六位整数单位，不接收归一化金额。 */
export function parsePolymarketMicroUsdc(raw: string | number | undefined): number {
  return polymarketBaseUnitAmount(raw);
}

/** BUY POST：makingAmount=USDC micro，takingAmount=份数 micro（对齐 bet.test / Polymarket 文档） */
export function parsePolymarketBuyOrderFill(
  response: { makingAmount?: string | number; takingAmount?: string | number } | null | undefined,
): { stakeUsdc: number; shares: number } {
  const stakeUsdc = parsePolymarketMicroUsdc(response?.makingAmount);
  const shares = polymarketBaseUnitAmount(response?.takingAmount);
  return { stakeUsdc, shares };
}

/** SELL POST：makingAmount=份数 micro，takingAmount=USDC micro */
export function parsePolymarketSellOrderFill(
  response: { makingAmount?: string | number; takingAmount?: string | number } | null | undefined,
): { proceedsUsdc: number; sharesSold: number } {
  const proceedsUsdc = parsePolymarketMicroUsdc(response?.takingAmount);
  const sharesSold = polymarketBaseUnitAmount(response?.makingAmount);
  return { proceedsUsdc, sharesSold };
}

/** /data/trades 成交 leg → 份数 + USDC 名义 */
export function polymarketTradeFillAmounts(
  trade: PolymarketTradeRow,
): { shares: number; usdc: number } {
  // 份数保留原始精度（展示用）；USDC 仍 round4
  const shares = polymarketShareCount(trade.size);
  const usdc = polymarketTradeNotionalUsdc(trade);
  return { shares, usdc };
}

/** 成交 USDC 名义（买=成本，卖=回款） */
export function polymarketTradeNotionalUsdc(trade: PolymarketTradeRow): number {
  const price = Number(trade.price);
  if (!Number.isFinite(price) || price <= 0)
    return 0;
  return Math.round(polymarketBuyStakeUsdc(trade.size, price) * 10000) / 10000;
}

export function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
