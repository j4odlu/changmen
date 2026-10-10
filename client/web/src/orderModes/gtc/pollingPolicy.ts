import type { GtcExecution } from "@changmen/shared/pm_gtc";
import type { OrderRow } from "@/types/order";
import { gtcCanFinishWithoutOrders, gtcUnits } from "@changmen/shared/pm_gtc";
import { resolveGtcFillFee } from "@changmen/venue-adapter/polymarket/gtc";

/** [changmen 扩展] 只依据原单终态、完整成交/费用证据；比赛结束本身不能证明挂单已终止。 */
export function gtcPmReconciled(row: GtcExecution): boolean {
  if (gtcCanFinishWithoutOrders(row)) return true;
  if (!row.terminal || !row.complete || row.error || row.open !== "0") return false;
  if (row.submit === "rejected") return gtcUnits(row.matched) === 0n && !Object.keys(row.fills).length;
  if (!row.order || row.submit !== "accepted") return false;
  const fills = Object.values(row.fills);
  if (fills.some(fill => !["CONFIRMED", "FAILED"].includes(fill.status))) return false;
  const valid = fills.filter(fill => fill.status !== "FAILED");
  if (valid.some(fill => fill.fee != null && (!Number.isFinite(Number(fill.fee)) || Number(fill.fee) < 0))) return false;
  if (valid.some(fill => fill.fee == null && resolveGtcFillFee(row.plan.feeProof, fill.role, Number(fill.shares), Number(fill.price)) == null)) return false;
  return gtcUnits(row.order.matched) === gtcUnits(row.matched)
    && valid.reduce((total, fill) => total + gtcUnits(fill.shares), 0n) === gtcUnits(row.matched)
    && row.order.tradeIds.every(id => fills.some(fill => fill.tradeId === id));
}

function finalOrder(row: GtcExecution, orders: OrderRow[], pm: boolean): boolean {
  const id = pm ? row.orderId : row.other.orderId;
  return Boolean(id) && orders.some(order => order.PmGtcExecutionId === row.id
    && order.PlayerID === (pm ? row.plan.playerId : row.plan.otherPlayerId)
    && order.Type === (pm ? "Polymarket" : row.plan.otherProvider)
    && String(order.OrderID ?? "").toLowerCase() === id!.toLowerCase()
    && order.PmSide !== "sell" && ["win", "lose", "lost", "return", "reject"].includes(String(order.Status).toLowerCase()));
}
export function gtcNeedsOtherPolling(row: GtcExecution, orders: OrderRow[]): boolean {
  return ["authorized", "accepted", "pending", "unknown"].includes(row.other.state)
    || (row.other.state === "filled" && !finalOrder(row, orders, false));
}
export function gtcExecutionDormant(row: GtcExecution, orders: OrderRow[]): boolean {
  if (row.decision !== "closed" || !gtcPmReconciled(row) || gtcNeedsOtherPolling(row, orders)) return false;
  return gtcUnits(row.matched) === 0n || finalOrder(row, orders, true);
}
