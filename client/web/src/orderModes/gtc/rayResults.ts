/** [changmen 扩展] PM 挂单记录被动消费原有 RAY 查单结果；没有查询定时器或下注/补单动作。 */
import type { GtcExecution } from "@changmen/shared/pm_gtc";
import type { OrderRow } from "@/types/order";
import { watch } from "vue";
import { observedRayOrders, rayOrderResults } from "@/runtime/orderMonitoring/rayOrders";
import { useAccountStore } from "@/stores/accountStore";
import { gtcOrderProjection } from "./executionProjection";
import { gtcProgress } from "./gtcProgressState";
import { pollGtcOther } from "./runtime";

export function findRayFinalOrder(row: GtcExecution): OrderRow | undefined {
  return row.plan.otherProvider === "RAY" && row.other.orderId
    ? gtcOrderProjection.rows.find(order => order.PmGtcExecutionId === row.id
      && order.PlayerID === row.plan.otherPlayerId && order.Type === "RAY"
      && String(order.OrderID).toLowerCase() === row.other.orderId!.toLowerCase()
      && ["win", "lose", "lost", "return", "reject"].includes(String(order.Status).toLowerCase()))
    : undefined;
}

let dispose: (() => void) | undefined;
let generation = 0;
const consumed = new Map<string, string>();
const pending = new Set<string>();
function consume(): void {
  if (!dispose)
    return;
  const stamp = generation;
  for (const row of [...gtcProgress.records]) {
    if (row.plan.otherProvider !== "RAY" || pending.has(row.id))
      continue;
    const final = findRayFinalOrder(row);
    const account = useAccountStore().findAccount(row.plan.otherPlayerId);
    const snapshot = account && observedRayOrders(account);
    if (!final && (!snapshot || snapshot.startedAt < row.other.submittedAt
      || !["authorized", "accepted", "pending", "unknown", "filled"].includes(row.other.state))) {
      continue;
    }
    const version = final ? `final:${final.OrderID}:${final.Status}` : `query:${snapshot!.sequence}`;
    if (consumed.get(row.id) === version)
      continue;
    consumed.set(row.id, version); pending.add(row.id);
    void pollGtcOther(row.id, row.decision === "closed").catch(() => {}).finally(() => {
      if (stamp !== generation)
        return;
      pending.delete(row.id); consume();
    });
  }
}
export function startRayResultConsumer(): void {
  if (dispose)
    return;
  dispose = watch(() => [rayOrderResults.revision, gtcProgress.records, gtcOrderProjection.rows], consume, { deep: true });
  consume();
}
export function stopRayResultConsumer(): void {
  generation++; dispose?.(); dispose = undefined; consumed.clear(); pending.clear();
}
