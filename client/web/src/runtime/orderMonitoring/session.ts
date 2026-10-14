/** [changmen 扩展] 页面会话管理场馆监控，GTC 仅作为状态消费者接入。 */
import { gtcProgress, initializeGtcState, resetGtcState } from "@/orderModes/gtc/executionState";
import { startGtcCoordinator, stopGtcCoordinator } from "@/orderModes/gtc/runtime";
import { startPmGtcMonitoring, stopPmGtcMonitoring } from "./pm";
import { startRayGtcMonitoring, stopRayGtcMonitoring } from "./ray";
import { resetRayOrderResults } from "./rayOrders";
import { resetMonitorRecovery } from "./recovery";

export function startOrderMonitoring(owner: string): void {
  if (gtcProgress.owner === owner)
    return;
  stopMonitoring(); initializeGtcState(owner);
  startGtcCoordinator(); startPmGtcMonitoring(); startRayGtcMonitoring();
}
function stopMonitoring(): void {
  stopPmGtcMonitoring(); stopRayGtcMonitoring(); stopGtcCoordinator();
  resetMonitorRecovery();
  resetRayOrderResults();
}
export function stopOrderMonitoring(): void { stopMonitoring(); resetGtcState(); }
