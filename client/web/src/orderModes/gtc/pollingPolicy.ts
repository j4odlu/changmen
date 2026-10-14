import type { GtcExecution } from "@changmen/shared/pm_gtc";
import type { OrderRow } from "@/types/order";
import { gtcCanFinishWithoutOrders, gtcPmNeverSubmitted, gtcUnits } from "@changmen/shared/pm_gtc";
import { resolveGtcFillFee } from "@changmen/venue-adapter/polymarket/gtc";

/** [changmen 扩展] 只依据原单终态、完整成交/费用证据；比赛结束本身不能证明挂单已终止。 */
export function gtcPmReconciled(row: GtcExecution): boolean {
  if (gtcCanFinishWithoutOrders(row))
    return true;
  if (row.decision === "closed" && gtcPmNeverSubmitted(row))
    return true;
  if (!row.terminal || !row.complete || row.error || row.open !== "0")
    return false;
  if (row.submit === "rejected")
    return gtcUnits(row.matched) === 0n && !Object.keys(row.fills).length;
  if (!row.order || row.submit !== "accepted")
    return false;
  const fills = Object.values(row.fills);
  if (fills.some(fill => !["CONFIRMED", "FAILED"].includes(fill.status)))
    return false;
  const valid = fills.filter(fill => fill.status !== "FAILED");
  if (valid.some(fill => fill.fee != null && (!Number.isFinite(Number(fill.fee)) || Number(fill.fee) < 0)))
    return false;
  if (valid.some(fill => fill.fee == null && resolveGtcFillFee(row.plan.feeProof, fill.role, Number(fill.shares), Number(fill.price)) == null))
    return false;
  return gtcUnits(row.order.matched) === gtcUnits(row.matched)
    && valid.reduce((total, fill) => total + gtcUnits(fill.shares), 0n) === gtcUnits(row.matched)
    && row.order.tradeIds.every(id => fills.some(fill => fill.tradeId === id));
}

export function findGtcFinalOrder(row: GtcExecution, orders: OrderRow[], pm: boolean): OrderRow | undefined {
  const id = pm ? row.orderId : row.other.orderId;
  return id
    ? orders.find(order => order.PmGtcExecutionId === row.id
      && order.PlayerID === (pm ? row.plan.playerId : row.plan.otherPlayerId)
      && order.Type === (pm ? "Polymarket" : row.plan.otherProvider)
      && String(order.OrderID ?? "").toLowerCase() === id!.toLowerCase()
      && order.PmSide !== "sell" && ["win", "lose", "lost", "return", "reject"].includes(String(order.Status).toLowerCase()))
    : undefined;
}
export function gtcNeedsOtherPolling(row: GtcExecution, orders: OrderRow[]): boolean {
  if (findGtcFinalOrder(row, orders, false))
    return false;
  return ["authorized", "accepted", "pending", "unknown"].includes(row.other.state)
    || row.other.state === "filled";
}
export function gtcExecutionDormant(row: GtcExecution, orders: OrderRow[]): boolean {
  if (row.decision !== "closed" || !gtcPmReconciled(row) || gtcNeedsOtherPolling(row, orders))
    return false;
  return gtcUnits(row.matched) === 0n || Boolean(findGtcFinalOrder(row, orders, true));
}
