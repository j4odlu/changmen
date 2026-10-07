import type { OrderObservationEvent } from "./order_observation";

/** [changmen 扩展] 实时面板与后台诊断共用的只读事实展示；不得参与业务判定。 */
export function observationEventStage(event: OrderObservationEvent): string {
  if (event.source === "ray_monitor")
    return "RAY订单监控";
  if (event.phase === "reject_detection" && (event.kind === "settlement_observed" || event.reasonCode === "reject_detection_started"))
    return "拒单检测";
  if (event.kind === "settlement_observed" && event.phase === "direct_fill")
    return "成交";
  if (event.kind.startsWith("execution_"))
    return "执行";
  if (event.kind.startsWith("precheck_"))
    return "预检";
  if (event.kind.startsWith("submission_"))
    return "下单";
  if (event.kind === "settlement_observed")
    return "确认";
  if (event.kind.startsWith("queue_"))
    return "补单";
  if (event.kind === "bind_result")
    return "绑定";
  if (event.kind === "transport_gap")
    return "缺口";
  return "决策";
}

const KIND_LABELS: Record<string, string> = {
  execution_started: "整轮执行开始",
  execution_finished: "编排结束（确认或补单可能继续）",
  precheck_started: "开始预检",
  precheck_result: "预检结果",
  submission_started: "开始场馆下注处理（尚未确认请求发出）",
  submission_result: "提交返回",
  settlement_observed: "确认观察",
  queue_created: "补单入队",
  queue_replaced: "补单任务被覆盖",
  queue_canceled: "补单取消",
  queue_removed: "补单出队",
  decision: "执行决策",
  bind_result: "绑定回执",
  transport_gap: "执行记录存在缺口",
};
const OUTCOME_LABELS: Record<string, string> = {
  orchestration_completed: "编排完成",
  exception: "编排异常",
  prepared: "预检已准备",
  blocked: "被拦截",
  not_submitted: "未开始场馆下注处理",
  accepted: "接口受理（尚不证明成交）",
  adapter_failed: "下注处理返回失败（不证明未成交）",
  unknown: "结果未知",
  filled: "观察到成交",
  unfilled: "观察到未成交",
  timeout: "仍待确认",
  saved: "已保存",
  failed: "失败",
  retry_selected: "已选择重试候选",
  registered: "登记观察",
  bound: "已关联订单",
  expired: "观察窗口结束",
};
const BUSINESS_OUTCOME_LABELS: Record<string, string> = { filled: "成交", unfilled: "未成交", timeout: "待确认" };
function lookupLabel(labels: Record<string, string>, value: string): string {
  return Object.hasOwn(labels, value) ? labels[value]! : value;
}

export function observationEventLabel(event: OrderObservationEvent): string {
  if (event.source === "ray_monitor") {
    const state = event.kind === "settlement_observed" && event.outcome === "unfilled" ? "检测到延迟拒单"
      : event.kind === "settlement_observed" && event.outcome === "filled" ? "订单已结算，监控结束"
        : event.outcome === "registered" ? "开始独立监控"
          : event.outcome === "bound" ? "已关联订单，持续监控"
            : event.outcome === "expired" ? "监控窗口结束" : lookupLabel(OUTCOME_LABELS, event.outcome || "未知");
    return ["RAY订单监控", state, event.safeSummary ? `原因：${event.safeSummary}` : ""].filter(Boolean).join(" · ");
  }
  if (event.reasonCode === "reject_detection_started")
    return "开始拒单检测";
  const label = event.kind === "settlement_observed" && event.phase === "reject_detection" ? "拒单检测" : lookupLabel(KIND_LABELS, event.kind);
  if (event.source === "timeout_policy")
    return `${label} · 按超时策略处理，非官方拒单回执`;
  if (event.source === "orchestration_result")
    return `${label} · 编排判定：${lookupLabel(BUSINESS_OUTCOME_LABELS, event.outcome || "未知")}，缺少精确订单确认`;
  const rejected = event.kind === "settlement_observed" && event.outcome === "unfilled" && event.observedStatus === "reject";
  const outcome = rejected ? "检测到拒单"
    : event.kind === "settlement_observed" && event.provider === "RAY" && event.observedStatus === "none" && event.outcome === "filled" ? "检测通过 · 未拒单"
      : event.kind === "submission_result" && event.provider === "Polymarket" && event.outcome === "accepted"
    ? event.observedStatus === "matched" ? "直接成交" : event.observedStatus === "delayed" ? "delayed · 等待拒单检测" : lookupLabel(OUTCOME_LABELS, event.outcome)
    : event.outcome ? lookupLabel(OUTCOME_LABELS, event.outcome) : "";
  const precheckReasons: Record<string, string> = {
    no_account: "当前场馆没有可用的下单账号",
    unsupported_provider: "当前场馆不支持下单预检",
    precheck_error: "预检未通过，未记录具体原因",
  };
  const reason = event.safeSummary || (event.kind === "precheck_result" && event.outcome === "blocked"
    && Object.hasOwn(precheckReasons, event.reasonCode || "") ? precheckReasons[event.reasonCode!] : "");
  return [label, outcome, reason ? `原因：${reason}` : "", event.responseCode ? `场馆码 ${event.responseCode}` : "", event.httpStatus ? `HTTP ${event.httpStatus}` : "", event.durationMs !== undefined ? `${event.durationMs}ms` : "", event.retryRound ? `重试第${event.retryRound}轮` : ""].filter(Boolean).join(" · ");
}

/** 没有 target 的回执仅在同一尝试/队列的方向唯一时归属；不靠平台或时间猜腿。 */
export function orderObservationTargets(events: readonly OrderObservationEvent[]): Map<OrderObservationEvent, string | undefined> {
  const groups = new Map<string, Set<string>>();
  const groupKey = (event: OrderObservationEvent) => event.attemptId
    ? `${event.ownerUserId}:attempt:${event.attemptId}`
    : event.queueId ? `${event.ownerUserId}:queue:${event.queueId}` : undefined;
  for (const event of events) {
    const key = groupKey(event);
    if (key && event.target) {
      const targets = groups.get(key) || new Set<string>();
      targets.add(event.target);
      groups.set(key, targets);
    }
  }
  return new Map(events.map((event) => {
    const key = groupKey(event);
    const targets = key ? groups.get(key) : undefined;
    return [event, event.target || (targets?.size === 1 ? [...targets][0] : undefined)];
  }));
}

/** 尝试内按序号排列；跨尝试按记录的发生时间展示，不推断跨尝试因果。 */
export function orderObservationTimeline(events: readonly OrderObservationEvent[]): OrderObservationEvent[] {
  const groups = new Map<string, OrderObservationEvent[]>();
  const seen = new Set<string>();
  for (const event of events) {
    const identity = `${event.ownerUserId}:${event.eventId}`;
    if (seen.has(identity))
      continue;
    seen.add(identity);
    const key = `${event.ownerUserId}:${event.attemptId ? `attempt:${event.attemptId}` : event.queueId ? `queue:${event.queueId}` : event.executionId ? `execution:${event.executionId}` : identity}`;
    const rows = groups.get(key) || [];
    rows.push(event);
    groups.set(key, rows);
  }
  const streams = [...groups.values()].map(rows => ({
    rows: [...rows].sort((a, b) => a.sequence - b.sequence || a.eventId.localeCompare(b.eventId)),
    index: 0,
  }));
  const timeline: OrderObservationEvent[] = [];
  // 合并各尝试的有序流，避免整组队列的“出队”被排到子尝试“提交”之前。
  while (streams.length) {
    let next = 0;
    for (let index = 1; index < streams.length; index++) {
      const candidate = streams[index]!.rows[streams[index]!.index]!;
      const current = streams[next]!.rows[streams[next]!.index]!;
      if (candidate.occurredAt < current.occurredAt
        || (candidate.occurredAt === current.occurredAt && candidate.eventId.localeCompare(current.eventId) < 0)) {
        next = index;
      }
    }
    const stream = streams[next]!;
    timeline.push(stream.rows[stream.index++]!);
    if (stream.index === stream.rows.length)
      streams.splice(next, 1);
  }
  return timeline;
}
