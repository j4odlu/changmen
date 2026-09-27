import type { RayRejectMonitorTask } from "@/extensions/arbBet/rayRejectMonitor/types";
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

/**
 * [changmen 扩展] 用户订单栏 RAY 监控卡片的只读展示模型。
 * 优先展示旁路监控状态；没有监控任务时，只陈述订单表和当前编排内存中可证实的状态。
 */
export function buildRayLinkMonitorModel(
  rows: readonly OrderRow[],
  run?: ActiveBetRun | null,
  monitor?: RayRejectMonitorTask | null,
): RayLinkMonitorModel {
  const link = Number(rows[0]?.Link) || 0;
  const rayRows = rows
    .filter(row => isRayProvider(row.Type))
    .sort((a, b) => (Number(b.CreateAt) || 0) - (Number(a.CreateAt) || 0));
  const row = rayRows.find(item => normalizedStatus(item.Status) === "reject") ?? rayRows[0];
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
    if (monitor.status === "expired") {
      return {
        visible: true,
        tone: "warning",
        label: "监控超时",
        summary: "观察窗口结束，未确认延迟拒单",
        orderId,
        venueStatus,
        observedAt,
        isLive: false,
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
    label: "持续监控待接入",
    summary: "场馆订单已落库，当前仅展示最新订单状态",
    orderId,
    venueStatus,
    observedAt,
    isLive: false,
  };
}
