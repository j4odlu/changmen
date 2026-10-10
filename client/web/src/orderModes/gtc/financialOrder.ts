import type { GtcExecution, GtcFinancialOrder } from "@changmen/shared/pm_gtc";
import { buildPolymarketMatchedBuyVenueOrderUsdc } from "@changmen/venue-adapter/polymarket";
import { scalePolymarketVenueOrdersForDisplay } from "@changmen/venue-adapter/polymarket/orders";

/** [changmen 扩展] 原单事实适配；金额、费用舍入、赔率和汇率均由普通 PM 助手处理。 */
export function gtcMatchedOrder(row: GtcExecution, fee: number) {
  const usdc = buildPolymarketMatchedBuyVenueOrderUsdc(row.orderId ?? `gtc-pending:${row.id}`, {
    status: "matched",
    takingAmount: row.matched,
  }, { fallbackStakeUsdc: Number(row.principal), feeUsdc: fee });
  return usdc ? scalePolymarketVenueOrdersForDisplay([usdc])[0]! : null;
}

export function gtcFinancialOrder(row: GtcExecution): GtcFinancialOrder | undefined {
  if (!row.orderId || row.fee == null || (!row.complete && !Object.values(row.fills).some(fill => fill.status === "FAILED")))
    return;
  if (Number(row.matched) === 0 && Object.values(row.fills).some(fill => fill.status === "FAILED"))
    return { pmShares: 0, pmFillPrice: 0, pmStakeUsdc: 0, pmFeeUsdc: 0, odds: 0, betMoney: 0 };
  const order = gtcMatchedOrder(row, Number(row.fee));
  if (!order)
    return;
  return { pmShares: order.pmShares!, pmFillPrice: order.pmFillPrice!, pmStakeUsdc: order.pmStakeUsdc!, pmFeeUsdc: order.pmFeeUsdc ?? 0, odds: order.odds, betMoney: order.betMoney };
}
