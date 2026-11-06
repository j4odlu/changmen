import type { GtcOrderState, GtcFinancialOrder } from "@changmen/shared/pm_gtc_order";
import { buildPolymarketMatchedBuyVenueOrderFromFillUsdc } from "@changmen/venue-browser/polymarket";
import { scalePolymarketVenueOrdersForDisplay } from "@changmen/venue-browser/polymarket/orders/history/orders";

/** [changmen 扩展] 原单事实适配；金额、费用舍入、赔率和汇率均由普通 PM 助手处理。 */
type FinancialState = Pick<GtcOrderState, "orderId" | "matched" | "principal" | "cost" | "fee" | "complete" | "fills"> & { id: string };
export function gtcMatchedOrder(row: FinancialState, fee: number) {
  const usdc = buildPolymarketMatchedBuyVenueOrderFromFillUsdc(row.orderId ?? `gtc-pending:${row.id}`, {
    stakeUsdc: Number(row.principal), shares: Number(row.matched),
  }, { feeUsdc: fee });
  if (!usdc)
    return null;
  if (row.cost != null) {
    // The total is official cash, never principal plus a recomputed fee.
    usdc.pmStakeUsdc = Number(row.cost);
    usdc.betMoney = Number(row.cost);
    usdc.pmFeeUsdc = fee;
    usdc.pmFillPrice = Number(row.principal) / Number(row.matched);
  }
  return scalePolymarketVenueOrdersForDisplay([usdc])[0]!;
}

export function gtcFinancialOrder(row: FinancialState): GtcFinancialOrder | undefined {
  if (!row.orderId || row.fee == null || (!row.complete && !Object.values(row.fills).some(fill => fill.status === "FAILED")))
    return;
  if (Number(row.matched) === 0 && Object.values(row.fills).some(fill => fill.status === "FAILED"))
    return { pmShares: 0, pmFillPrice: 0, pmStakeUsdc: 0, pmFeeUsdc: 0, odds: 0, betMoney: 0 };
  const order = gtcMatchedOrder(row, Number(row.fee));
  if (!order)
    return;
  return { pmShares: order.pmShares!, pmFillPrice: order.pmFillPrice!, pmStakeUsdc: order.pmStakeUsdc!, pmFeeUsdc: order.pmFeeUsdc ?? 0, odds: order.odds, betMoney: order.betMoney };
}
