import type { OrderMarketIdentity } from "./order_market_identity";
/** [changmen 扩展] GTC 受理原单及已确认成交；不含发送授权或撤单命令。 */
import type { GtcFill, GtcFinancialOrder, GtcOrderState } from "./pm_gtc_order";
import { gtcUnits } from "./pm_gtc_order.ts";

export interface GtcAcceptedOrder {
  shares: string;
  price: string;
}
export function normalizeGtcAcceptedOrder(value: unknown): GtcAcceptedOrder | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const row = value as GtcAcceptedOrder;
  if (Object.keys(row).some(key => !["shares", "price"].includes(key))
    || typeof row.shares !== "string" || typeof row.price !== "string") return;
  try {
    const shares = gtcUnits(row.shares); const price = gtcUnits(row.price);
    if (shares <= 0n || price <= 0n || price >= 1_000_000n) return;
  }
  catch { return; }
  return { shares: row.shares, price: row.price };
}
export function gtcAcceptedOrder(row: Pick<GtcOrderState, "submit" | "orderId">
  & { plan: Pick<GtcOrderState["plan"], "shares" | "price"> }): GtcAcceptedOrder | undefined {
  if (row.submit !== "accepted" || !row.orderId) return;
  return normalizeGtcAcceptedOrder({ shares: row.plan.shares, price: row.plan.price });
}
/** [changmen 扩展] 沿用普通订单状态：核实零成交且原单已终止时为退；部分成交仍待结算。 */
export function gtcOrderResultStatus(row: Pick<GtcOrderState, "submit" | "terminal" | "complete" | "error" | "matched" | "order">): "None" | "Return" {
  return row.submit === "accepted" && row.terminal && row.complete && !row.error && row.order
    && gtcUnits(row.matched) === 0n && gtcUnits(row.order.matched) === 0n ? "Return" : "None";
}
/** 只排除明确尚无已确认成交的新格式买单；旧订单及卖单沿用原口径。 */
export function isUnfilledGtcOrder(row: { Type?: string; PmSide?: string; PmOrderType?: string; PmGtcExecutionId?: string; PmGtcBuyShares?: number }): boolean {
  return row.Type === "Polymarket" && row.PmSide !== "sell" && Boolean(row.PmOrderType === "GTC" || row.PmGtcExecutionId)
    && row.PmGtcBuyShares === 0;
}
export interface GtcConfirmedResult {
  status?: "None" | "Return";
  acceptedOrder?: GtcAcceptedOrder;
  clientMarket?: OrderMarketIdentity;
  executionId: string;
  orderId: string;
  playerId: number;
  linkId: number;
  createdAt: number;
  revision: number;
  match: string;
  bet: string;
  item: string;
  tokenId: string;
  conditionId: string;
  buyShares: string;
  principalUsdc: string;
  feeUsdc: string;
  fills: GtcFill[];
  financial: GtcFinancialOrder;
}
