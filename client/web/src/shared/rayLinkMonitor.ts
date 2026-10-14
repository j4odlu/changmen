import type { RayOrderContext } from "@/runtime/rayOrderMonitor/types";
import type { RayMonitoringState } from "@/runtime/orderMonitoring/rayState";
import type { ActiveBetRun } from "@/types/activeBetRun";
import type { OrderRow } from "@/types/order";

export type RayLinkMonitorTone = "neutral" | "info" | "warning" | "danger" | "success";

export interface RayLinkMonitorModel {
  visible: boolean;
  tone: RayLinkMonitorTone;
  label: string;
  summary: string;
  orderId: string;
  venueStatus: string;
  observedAt: number;
  detail?: string;
  isLive: boolean;
  timeLabel?: string;
}

function isRayProvider(value: unknown): boolean {
  return String(value ?? "").trim().toUpperCase() === "RAY";
}

function normalizedStatus(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function statusText(value: unknown): string {
  const status = normalizedStatus(value);
  if (status === "reject")
    return "拒单";
  if (status === "pending")
    return "待确认";
  if (status === "none")
    return "未结算";
  if (status === "win")
    return "赢";
  if (status === "lose")
    return "输";
  if (status === "return")
    return "退回";
  return String(value ?? "未知");
}

export function rayLinkMonitorOrder(rows: readonly OrderRow[]): OrderRow | undefined {
  const rayRows = rows.filter(row => isRayProvider(row.Type))
    .sort((a, b) => (Number(b.CreateAt) || 0) - (Number(a.CreateAt) || 0));
  return rayRows.find(row => normalizedStatus(row.Status) === "reject") ?? rayRows[0];
}

/**
 * [changmen 扩展] 用户订单栏 RAY 监控卡片的只读展示模型。
 * 状态和关联/补单上下文均来自同一独立订单监控；无任务时展示已知订单事实。
 */
export function buildRayLinkMonitorModel(
  rows: readonly OrderRow[],
  run?: ActiveBetRun | null,
  monitor?: RayOrderContext | null,
  monitoring?: RayMonitoringState,
): RayLinkMonitorModel {
  const link = Number(rows[0]?.Link) || 0;
  const row = rayLinkMonitorOrder(rows);
  if ((!row && !monitor) || link <= 0) {
    return {
      visible: false,
      tone: "neutral",
      label: "",
      summary: "",
      orderId: "",
      venueStatus: "",
      observedAt: 0,
      isLive: false,
    };
  }

  const orderId = String(monitor?.boundOrderId ?? row?.OrderID ?? "").trim();
  const venueStatus = statusText(monitor?.lastObservedStatus ?? row?.Status);
  const observedAt = Number(monitor?.updatedAt) || Number(run?.updatedAt) || Number(row?.CreateAt) || 0;
  const rayLeg = run?.legs.find(leg => isRayProvider(leg.platform));
  const rowStatus = normalizedStatus(row?.Status);

  // [changmen 扩展] 查询事实决定监控状态，同一模块记录的拒单补单交接结果单独展示。
  if (monitoring && row && monitor?.status !== "rejected") {
    const rejected = normalizedStatus(monitoring.status) === "reject";
    return {
      visible: true,
      tone: rejected ? "danger" : monitoring.error ? "warning" : monitoring.phase === "closed" ? "success" : "info",
      label: monitoring.phase === "closed" ? "监控已结束" : monitoring.error ? "监控重试中" : "持续监控中",
      summary: monitoring.phase === "closed" ? `RAY 场馆结果：${statusText(monitoring.status)}` : "原单状态独立核对，终态后自动停止",
      orderId: String(row.OrderID ?? ""),
      venueStatus: statusText(monitoring.status ?? row.Status),
      observedAt: monitoring.updatedAt,
      timeLabel: "最近核对",
      detail: monitoring.error,
      isLive: monitoring.phase === "watching",
    };
  }

  if (monitor) {
    const delaySec = Math.max(0, Math.round(Number(monitor.rejectDelayMs) / 1000));
    if (monitor.status === "rejected") {
      const action = monitor.autoMakeupStatus;
      const actionSummary = action === "enqueued"
        ? "已进入现有补单队列"
        : action === "enqueuing"
          ? "正在交给现有补单策略"
          : action === "failed"
            ? "自动补单处理失败"
            : action === "skipped"
              ? "未自动入队"
              : "仅记录告警";
      return {
        visible: true,
        tone: "danger",
        label: "延迟拒单已发现",
        summary: `RAY 受理后 ${delaySec}s 拒单 · ${actionSummary}`,
        orderId,
        venueStatus: "拒单",
        observedAt,
        detail: monitor.autoMakeupReason,
        isLive: false,
      };
    }
    if (monitor.status === "watching") {
      return {
        visible: true,
        tone: "info",
        label: "持续监控中",
        summary: monitor.boundOrderId
          ? `场馆单已绑定 · 已检查 ${monitor.pollCount} 次`
          : "正在确认场馆订单",
        orderId,
        venueStatus,
        observedAt,
        isLive: true,
      };
    }
    if (monitor.status === "binding" || monitor.status === "ambiguous") {
      return {
        visible: true,
        tone: "warning",
        label: monitor.status === "ambiguous" ? "匹配需核对" : "正在定位场馆单",
        summary: monitor.status === "ambiguous"
          ? `发现 ${monitor.candidateCount} 张相似订单，未自动绑定`
          : "RAY 已受理，正在等待对应场馆订单出现",
        orderId,
        venueStatus,
        observedAt,
        isLive: true,
      };
    }
    if (monitor.status === "closed") {
      return {
        visible: true,
        tone: "success",
        label: "监控已结束",
        summary: `RAY 场馆结果：${venueStatus}`,
        orderId,
        venueStatus,
        observedAt,
        isLive: false,
      };
    }
  }

  if (run?.phase === "makeup" || rayLeg?.status === "makeup") {
    return {
      visible: true,
      tone: "warning",
      label: "补单处理中",
      summary: "原始订单存在风险，正在执行补单流程",
      orderId,
      venueStatus,
      observedAt,
      detail: rayLeg?.detail,
      isLive: true,
    };
  }

  if (run?.overallLabel === "自动补单已关闭") {
    return {
      visible: true,
      tone: "danger",
      label: "拒单已确认",
      summary: "自动补单已关闭，未执行补单",
      orderId,
      venueStatus,
      observedAt,
      detail: rayLeg?.detail,
      isLive: false,
    };
  }

  if (rowStatus === "reject" || rayLeg?.status === "rejected") {
    return {
      visible: true,
      tone: "danger",
      label: "拒单已确认",
      summary: "RAY 场馆订单已拒绝，请检查补单处理",
      orderId,
      venueStatus: "拒单",
      observedAt,
      detail: rayLeg?.detail,
      isLive: Boolean(run),
    };
  }

  if (rayLeg && ["submitted", "pending_confirm", "placing", "pending"].includes(rayLeg.status)) {
    return {
      visible: true,
      tone: "info",
      label: "场馆确认中",
      summary: "RAY 已受理，当前编排正在确认订单状态",
      orderId,
      venueStatus,
      observedAt,
      detail: rayLeg.detail,
      isLive: true,
    };
  }

  if (rayLeg?.status === "confirmed") {
    return {
      visible: true,
      tone: "success",
      label: "首次确认通过",
      summary: "本轮编排未发现拒单",
      orderId,
      venueStatus,
      observedAt,
      detail: rayLeg.detail,
      isLive: true,
    };
  }

  if (["win", "lose", "return"].includes(rowStatus)) {
    return {
      visible: false,
      tone: "neutral",
      label: "",
      summary: "",
      orderId: "",
      venueStatus: "",
      observedAt: 0,
      isLive: false,
    };
  }

  return {
    visible: true,
    tone: "neutral",
    label: "等待恢复监控",
    summary: "场馆订单已落库，当前仅展示最新订单状态",
    orderId,
    venueStatus,
    observedAt,
    isLive: false,
  };
}
