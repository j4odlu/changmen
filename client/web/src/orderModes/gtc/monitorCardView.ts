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
  const cancelAcknowledged = row.cancel?.state === "acknowledged";
  const cancelRetry = !row.terminal && Boolean(row.cancel && ["unknown", "failed"].includes(row.cancel.state));
  const cancelLabel = !row.terminal && row.cancel ? {
    requested: "取消中",
    dispatching: "取消中",
    acknowledged: "PM 已确认取消剩余挂单，正在同步订单状态",
    unknown: "取消结果待核实，正在查询原单状态",
    failed: "取消失败",
  }[row.cancel.state] : "";
  // 查询仍在继续时也展示撤单错误，避免统一提示遮住超时、鉴权或官方拒绝原因。
  const message = row.cancel?.message.trim() || "";
  const cancelDetail = (cancelRetry || (row.terminal && cancelAcknowledged)) && message !== cancelLabel ? message : "";
  const status = String(row.order?.status).toUpperCase();
  const canceled = row.terminal && ["CANCELED", "CANCELLED", "CANCELED_MARKET_RESOLVED"].includes(status);
  const state = status === "CANCELED_MARKET_RESOLVED" && canceled
    ? Number(row.matched) > 0 ? "部分成交 · 市场已结算，剩余挂单已取消" : "市场已结算，挂单已取消"
    : status === "INVALID" ? "订单无效 · 余量待核实"
      : canceled ? Number(row.matched) > 0 ? "部分成交 · 剩余挂单已取消" : "已取消" : order.state;
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
    cancelDetail,
    cancelRetry,
    cancelInFlight: cancelInFlight,
    showCancel: order.showCancel && !cancelAcknowledged,
    canCancel: order.canCancel && !cancelInFlight && !cancelAcknowledged,
    monitorLabel: issue ? issue.kind === "auth" ? "同步暂停" : "监控重试中" : reconciled ? "核对完成" : "监控中",
    monitorTone: issue || cancelRetry || order.detailError || order.verification.length ? "warning" : order.tone === "fail" ? "danger" : reconciled ? "success" : "info",
  };
}

export function pmGtcMonitorCardView(row: GtcExecution, issue?: GtcSyncIssue) {
  return monitorCardView(row, gtcPmReconciled(row), Boolean(gtcProgress.cancelInFlight[row.id]), issue);
}
export function nativeGtcMonitorCardView(row: GtcOrderRecord, issue?: GtcSyncIssue) {
  return monitorCardView(row, gtcOrderReconciled(row), Boolean(gtcOrders.cancelInFlight[row.id]), issue);
}
