/** [changmen 扩展] 旧执行入口兼容；后台监控由并列的 gtcOrderMonitor 模块拥有。 */
import { pollGtc } from "@/runtime/gtcOrderMonitor/pm";
import { gtcProgress, mutateGtc, refreshGtcRecords } from "./executionState";

export { acceptGtc, beginGtcInitialDispatch, currentGtc, gtcActivated, gtcProgress, markGtcLegOnce, mutateGtc, refreshGtcRecords } from "./executionState";
export { cancelGtc, pollGtc } from "@/runtime/gtcOrderMonitor/pm";
export { pollGtcOther } from "@/runtime/gtcOrderMonitor/counterpart";
export { startGtcOrderMonitoring as startGtcRuntime, stopGtcOrderMonitoring as stopGtcRuntime } from "@/runtime/gtcOrderMonitor/runtime";
export { startGtcCoordinator, stopGtcCoordinator } from "@/runtime/gtcOrderMonitor/coordinator";
/** [changmen 扩展] 兼容旧记录人工确认；只修订旧组。 */
export async function resumeGtcAfterManualReview(): Promise<void> {
  await refreshGtcRecords();
  for (const row of [...gtcProgress.records].filter(r => !r.released)) {
    await pollGtc(row.id); await mutateGtc(row.id, { kind: "resume" });
  }
}
