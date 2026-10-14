/** [changmen 扩展] GTC 订单监控的独立会话，只管理自身查询、恢复和订阅。 */
import { gtcProgress, initializeGtcState, resetGtcState } from "@/orderModes/gtc/executionState";
import { startGtcCoordinator, stopGtcCoordinator } from "./coordinator";
import { startPmGtcMonitoring, stopPmGtcMonitoring } from "./pm";
import { startGtcCounterpartMonitoring, stopGtcCounterpartMonitoring } from "./counterpart";
import { resetMonitorRecovery } from "./recovery";

let monitoringOwner = "";

export function startGtcOrderMonitoring(owner: string): void {
  if (monitoringOwner === owner && gtcProgress.owner === owner)
    return;
  stopMonitoring(); initializeGtcState(owner); monitoringOwner = owner;
  startGtcCoordinator(); startPmGtcMonitoring(); startGtcCounterpartMonitoring();
}
function stopMonitoring(): void {
  monitoringOwner = "";
  stopPmGtcMonitoring(); stopGtcCounterpartMonitoring(); stopGtcCoordinator();
  resetMonitorRecovery();
}
export function stopGtcOrderMonitoring(): void { stopMonitoring(); resetGtcState(); }
