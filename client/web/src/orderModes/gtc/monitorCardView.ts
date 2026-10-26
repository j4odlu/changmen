import type { GtcOrderState } from "@changmen/shared/pm_gtc_order";
import type { GtcOrderRecord } from "./core/orderRecord";
import { gtcOrderReconciled } from "./core/orderRecord";
import { gtcOrders } from "./orderState";
import type { GtcExecution } from "@changmen/shared/pm_gtc";
import type { GtcSyncIssue } from "./syncStatus";
import { formatPolymarketApiDecimal } from "@/shared/pmOrderDisplay";
import { gtcProgress } from "./gtcProgressState";
import { gtcOrderCardView } from "./orderCardView";
import { gtcPmReconciled } from "./pollingPolicy";

/** [changmen 扩展] PM 原单监控只读展示；不启动查询、不修改执行或财务事实。 */
function monitorCardView(row: GtcOrderState & { id: string }, reconciled: boolean, cancelInFlight: boolean, issue?: GtcSyncIssue) {
  const order = gtcOrderCardView(row);
  const cancelPending = !row.terminal && Boolean(row.cancel && ["requested", "dispatching", "unknown", "acknowledged"].includes(row.cancel.state));
  const cancelLabel = cancelPending
    ? row.cancel?.state === "requested" || row.cancel?.state === "dispatching" ? "取消中" : "取消结果待核实"
    : "";
  const canceled = row.terminal && ["CANCELED", "CANCELLED"].includes(String(row.order?.status).toUpperCase());
  const state = canceled ? Number(row.matched) > 0 ? "部分成交 · 剩余挂单已取消" : "已取消" : order.state;
  const principal = Number(order.principal);
  const matched = Number(row.matched);
  const averagePrice = order.principal != null && Number.isFinite(principal) && matched > 0
    ? formatPolymarketApiDecimal(principal / matched)
    : null;
  return {
    ...order,
    state,
    averagePrice,
    reconciled,
    cancelPending,
    cancelLabel,
    cancelInFlight: cancelInFlight,
    canCancel: order.canCancel && !cancelInFlight,
    monitorLabel: issue ? issue.kind === "auth" ? "同步暂停" : "监控重试中" : reconciled ? "核对完成" : "监控中",
    monitorTone: issue || order.detailError || order.verification.length ? "warning" : order.tone === "fail" ? "danger" : reconciled ? "success" : "info",
  };
}

export function pmGtcMonitorCardView(row: GtcExecution, issue?: GtcSyncIssue) {
  return monitorCardView(row, gtcPmReconciled(row), Boolean(gtcProgress.cancelInFlight[row.id]), issue);
}
export function nativeGtcMonitorCardView(row: GtcOrderRecord, issue?: GtcSyncIssue) {
  return monitorCardView(row, gtcOrderReconciled(row), Boolean(gtcOrders.cancelInFlight[row.id]), issue);
}
