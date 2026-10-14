/** [changmen 扩展] GTC 编排只消费场馆监控状态，处理执行窗口关闭；不调度场馆查询。 */
import { gtcCanFinishWithoutOrders } from "@changmen/shared/pm_gtc";
import { watch } from "vue";
import { createOrderMonitorLoop } from "@/runtime/orderMonitoring/loop";
import { pollGtc } from "@/runtime/orderMonitoring/pm";
import { captureGtcSession, gtcProgress, mutateGtc, refreshGtcRecords } from "./executionState";

export { acceptGtc, currentGtc, gtcActivated, gtcProgress, markGtcLegOnce, mutateGtc, refreshGtcRecords } from "./executionState";
export { cancelGtc, pollGtc } from "@/runtime/orderMonitoring/pm";
export { pollGtcOther } from "@/runtime/orderMonitoring/ray";
const closures = new Map<string, Promise<unknown>>();
let dispose: (() => void) | undefined;
const coordinator = createOrderMonitorLoop({
  active: () => gtcProgress.records.some(row => !row.released && row.decision === "open"),
  tick() {
    for (const row of [...gtcProgress.records]) {
      if (row.released || closures.has(row.id))
        continue;
      if (gtcCanFinishWithoutOrders(row) || (row.decision === "open"
        && (row.deadlineAt ? Date.now() > row.deadlineAt : Date.now() - row.createdAt > 10000))) {
        const isCurrent = captureGtcSession();
        const task = mutateGtc(row.id, { kind: "close" }).catch(() => {
          if (isCurrent())
            gtcProgress.error = "有旧 GTC 原单核对失败，其他订单继续独立核对";
        }).finally(() => {
          if (closures.get(row.id) === task)
            closures.delete(row.id);
        });
        closures.set(row.id, task);
      }
    }
  },
});
export { startOrderMonitoring as startGtcRuntime, stopOrderMonitoring as stopGtcRuntime } from "@/runtime/orderMonitoring/session";
export function startGtcCoordinator(): void {
  coordinator.start();
  dispose?.();
  dispose = watch(() => gtcProgress.records.map(row => `${row.id}:${row.revision}`).join(","), () => coordinator.consume(), { flush: "post" });
}
export function stopGtcCoordinator(): void {
  coordinator.stop(); dispose?.(); dispose = undefined; closures.clear();
}
/** [changmen 扩展] 兼容旧记录人工确认；只修订旧组。 */
export async function resumeGtcAfterManualReview(): Promise<void> {
  await refreshGtcRecords();
  for (const row of [...gtcProgress.records].filter(r => !r.released)) {
    await pollGtc(row.id); await mutateGtc(row.id, { kind: "resume" });
  }
}
