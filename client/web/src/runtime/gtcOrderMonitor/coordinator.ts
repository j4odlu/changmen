/** [changmen 扩展] 恢复后的 GTC 发送窗口关闭；只消费执行状态，不查询或提交场馆订单。 */
import { gtcCanFinishWithoutOrders } from "@changmen/shared/pm_gtc";
import { watch } from "vue";
import { createOrderMonitorLoop } from "@/runtime/orderMonitoring/loop";
import { captureGtcSession, gtcInitialDispatches, gtcProgress, mutateGtc } from "@/orderModes/gtc/executionState";

const closures = new Map<string, Promise<unknown>>();
let dispose: (() => void) | undefined;
const coordinator = createOrderMonitorLoop({
  active: () => gtcProgress.records.some(row => !row.released && row.decision === "open"),
  tick() {
    for (const row of [...gtcProgress.records]) {
      if (row.released || closures.has(row.id) || gtcInitialDispatches.has(row.id))
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

export function startGtcCoordinator(): void {
  coordinator.start();
  dispose?.();
  dispose = watch(() => `${gtcInitialDispatches.size}:${gtcProgress.records.map(row => `${row.id}:${row.revision}`).join(",")}`, () => coordinator.consume(), { flush: "post" });
}

export function stopGtcCoordinator(): void {
  coordinator.stop(); dispose?.(); dispose = undefined; closures.clear();
}
