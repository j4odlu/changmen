/** [changmen 扩展] GTC 对侧事实消费：RAY 只消费已有查单结果，其它场馆保持原同步调度。 */
import type { VenueOrder } from "@changmen/venue-adapter/contract";
import type { OrderRow } from "@/types/order";
import { watch } from "vue";
import { captureGtcSession, currentGtc, financialOrders, gtcInitialDispatches, gtcProgress, markGtcLegOnce, mutateGtc, settlement } from "@/orderModes/gtc/executionState";
import { findGtcOtherOrder } from "@/orderModes/gtc/otherFacts";
import { readGtcOtherOrders } from "@/orderModes/gtc/otherOrders";
import { findGtcFinalOrder, gtcNeedsOtherPolling } from "@/orderModes/gtc/pollingPolicy";
import { gtcSyncIssue } from "@/orderModes/gtc/syncStatus";
import { useAccountStore } from "@/stores/accountStore";
import { createOrderMonitorLoop } from "@/runtime/orderMonitoring/loop";
import { observedRayOrders, rayOrderResults } from "@/runtime/orderMonitoring/rayOrders";
import { recoverMonitorRecords } from "./recovery";
import { recoveryRetryDelay } from "./recoveryPolicy";
import { updateGtcCounterpartLocally } from "./localOrders";

const otherPolls = new Map<string, Promise<VenueOrder[]>>();
export async function pollGtcOther(id: string, confirm = true): Promise<VenueOrder[]> {
  const existing = otherPolls.get(id);
  if (existing)
    return existing;
  const isCurrent = captureGtcSession();
  const task = (async () => {
    try {
      const row = currentGtc(id);
      const final = findGtcFinalOrder(row, financialOrders(), false);
      if (final) {
        const state = ["reject", "return"].includes(String(final.Status).toLowerCase()) ? "rejected" : "filled";
        if (state !== row.other.state)
          await mutateGtc(id, { kind: "other", state, orderId: row.other.orderId! });
        if (!isCurrent())
          throw new Error("GTC 会话已变更");
        delete gtcProgress.otherQueryIssues[id];
        markGtcLegOnce(currentGtc(id), "OTHER");
        return [];
      }
      const account = useAccountStore().findAccount(row.plan.otherPlayerId);
      if (!account)
        throw new Error("GTC 原对侧账号暂不可用");
      const orders = await readGtcOtherOrders(account, row);
      if (!isCurrent())
        throw new Error("GTC 会话已变更");
      const current = currentGtc(id);
      const original = findGtcOtherOrder(current, orders);
      if (!original) {
        gtcProgress.otherQueryIssues[id] = gtcSyncIssue(new Error("对侧原单暂未唯一核实，继续查询"));
        return [];
      }
      const state = ["reject", "return"].includes(original.status)
        ? "rejected"
        : original.status === "pending"
          ? "pending"
          : confirm || current.other.state === "filled" ? "filled" : "accepted";
      updateGtcCounterpartLocally(account.accountId, original);
      if (state !== current.other.state || original.orderId !== current.other.orderId)
        await mutateGtc(id, { kind: "other", state, orderId: original.orderId, message: "" });
      if (!isCurrent())
        throw new Error("GTC 会话已变更");
      delete gtcProgress.otherQueryIssues[id];
      settlement.rememberOther(currentGtc(id), original);
      markGtcLegOnce(currentGtc(id), "OTHER");
      return orders;
    }
    catch (error) {
      if (isCurrent()) {
        gtcProgress.otherQueryIssues[id] = gtcSyncIssue(error);
      }
      throw error;
    }
  })();
  otherPolls.set(id, task);
  try { return await task; }
  finally {
    if (otherPolls.get(id) === task)
      otherPolls.delete(id);
    if (dispose)
      queueMicrotask(consumeRayResults);
  }
}

const loop = createOrderMonitorLoop({
  recover: recoverMonitorRecords,
  active: () => !gtcProgress.ready || gtcProgress.records.some(row => row.plan.otherProvider === "RAY"
    ? Boolean(gtcProgress.otherQueryIssues[row.id] && findGtcFinalOrder(row, financialOrders(), false))
    : needsMonitoring(row)),
  tick() {
    consumeRayResults();
    for (const row of [...gtcProgress.records]) {
      if (gtcInitialDispatches.has(row.id)) continue;
      if (row.plan.otherProvider !== "RAY" && needsMonitoring(row))
        void pollGtcOther(row.id, row.decision === "closed").catch(() => {});
    }
  },
});
function needsMonitoring(row: import("@changmen/shared/pm_gtc").GtcExecution): boolean {
  const orders = financialOrders();
  return gtcNeedsOtherPolling(row, orders) || Boolean(gtcProgress.otherQueryIssues[row.id])
    || Boolean(findGtcFinalOrder(row, orders, false) && !["filled", "rejected"].includes(row.other.state));
}
let dispose: (() => void) | undefined;
const consumed = new Map<string, number>();
const consumedFinal = new Map<string, OrderRow>();
const finalRetries = new Map<string, { final: OrderRow; at: number; failures: number }>();
function consumeRayResults(): void {
  if (!dispose)
    return;
  for (const row of [...gtcProgress.records]) {
    if (row.plan.otherProvider !== "RAY" || otherPolls.has(row.id) || gtcInitialDispatches.has(row.id))
      continue;
    const final = findGtcFinalOrder(row, financialOrders(), false);
    if (final) {
      const state = ["reject", "return"].includes(String(final.Status).toLowerCase()) ? "rejected" : "filled";
      const retry = finalRetries.get(row.id);
      if (retry?.final === final && Date.now() < retry.at)
        continue;
      if ((row.other.state !== state || gtcProgress.otherQueryIssues[row.id]) && consumedFinal.get(row.id) !== final) {
        const isCurrent = captureGtcSession();
        consumedFinal.set(row.id, final);
        void pollGtcOther(row.id).then(() => {
          if (isCurrent()) finalRetries.delete(row.id);
        }, () => {
          if (!isCurrent()) return;
          // 失败不能永久标为已消费，也不能因深度 watch 和 finally 回调立即循环。
          const failures = (retry?.final === final ? retry.failures : 0) + 1;
          finalRetries.set(row.id, { final, failures, at: Date.now() + recoveryRetryDelay(failures) });
          consumedFinal.delete(row.id);
        });
      }
      continue;
    }
    if (!needsMonitoring(row))
      continue;
    const account = useAccountStore().findAccount(row.plan.otherPlayerId);
    const snapshot = account && observedRayOrders(account);
    if (!snapshot || snapshot.startedAt < row.other.submittedAt || consumed.get(row.id) === snapshot.sequence)
      continue;
    consumed.set(row.id, snapshot.sequence);
    void pollGtcOther(row.id, row.decision === "closed").catch(() => {});
  }
}
export function startGtcCounterpartMonitoring(): void {
  if (dispose)
    return;
  dispose = watch(() => [rayOrderResults.revision, gtcProgress.records, financialOrders(), gtcProgress.otherQueryIssues, gtcInitialDispatches], consumeRayResults, { deep: true });
  consumeRayResults();
  loop.start();
}
export function stopGtcCounterpartMonitoring(): void {
  dispose?.(); dispose = undefined;
  loop.stop(); otherPolls.clear(); consumed.clear(); consumedFinal.clear(); finalRetries.clear();
}
