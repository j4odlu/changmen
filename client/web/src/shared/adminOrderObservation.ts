import type { AdminOrderLogLookup } from "@/types/admin";
import type { OrderObservationEvent } from "@changmen/shared/order_observation";

export function hasDirectAdminDiagnosis(data: AdminOrderLogLookup | null) {
  return data?.observation?.status === "available" && data.observation.events.length > 0;
}

/** [changmen 扩展] 只投影服务端判定和原始记录，不从时间相近或场馆相同推造关联。 */
export function adminObservationAttempts(data: AdminOrderLogLookup) {
  return (data.observation?.attempts || []).map(attempt => {
    const events = attempt.events;
    const identity = (key: "provider" | "accountId" | "target" | "executionId" | "parentAttemptId" | "queueId" | "retryRound") =>
      [...new Set(events.map(event => event[key]).filter(value => value !== undefined && value !== ""))].join(" / ") || "未记录";
    const byId = new Map(events.map(event => [event.eventId, event]));
    const stages = (["precheck", "submission", "binding", "confirmation"] as const).map(key => {
      const result = key === "confirmation" ? attempt.confirmation : attempt.progress?.[key];
      return { key, title: { precheck: "预检", submission: "提交下注", binding: "绑定订单", confirmation: "场馆确认 / 当前状态" }[key],
        label: result?.label || (key === "confirmation" && events.some(event => event.kind === "settlement_observed") ? "原始确认 / 策略记录" : "未记录明确结果"), detail: key === "confirmation" ? attempt.confirmation?.basis || "" : "",
        events: result ? result.proof.events.map(event => byId.get(event.eventId) || event)
          : key === "confirmation" ? events.filter(event => event.kind === "settlement_observed") : [],
        records: result?.proof.records || [] };
    });
    const orders = data.orders.filter(order => events.some(event => event.orderId === order.orderId
      && event.provider === order.provider && event.accountId !== undefined
      && String(event.accountId) === String(order.playerId) && event.linkId === order.link));
    const shown = new Set(stages.flatMap(stage => stage.events.map(event => event.eventId)));
    const processEvents = events.filter(event => !shown.has(event.eventId));
    return { ...attempt, stages, orders, processEvents, provider: identity("provider"), accountId: identity("accountId"),
      target: identity("target"), executionId: identity("executionId"), parentAttemptId: identity("parentAttemptId"),
      queueId: identity("queueId"), retryRound: identity("retryRound") };
  });
}

export function adminObservationIssues(data: AdminOrderLogLookup | null) {
  return [...new Set([...(data?.observation?.issues || []),
    ...(data?.observation?.attempts || []).flatMap(attempt => attempt.findings),
    ...(data?.observation?.queues || []).flatMap(queue => queue.findings)])];
}

export function adminObservationSource(event: OrderObservationEvent) {
  const labels: Record<string, string> = { adapter: "场馆查询回执（客户端上报）", adapter_result: "下单接口返回（客户端上报）",
    orchestration_result: "编排结果", timeout_policy: "本地超时策略", order_record: "订单记录观察",
    bind_api_ack: "绑定接口回执", ray_bind_api_ack: "RAY 绑定接口回执", ray_monitor: "RAY 订单监控" };
  return labels[event.source || ""] || event.source || "来源未记录";
}

export function adminObservationReport(data: AdminOrderLogLookup) {
  return [
    `下单诊断 · 完整 Link ${data.link} · ${data.user.userName}`,
    `直接执行记录 ${data.observation?.events.length || 0} 条；旧日志${data.legacyLogsLoaded ? "已补查" : "未查询"}`,
    ...adminObservationAttempts(data).flatMap(attempt => [
      `${attempt.provider} ${attempt.target} · 账号 ${attempt.accountId} · 尝试 ${attempt.attemptId} · 执行 ${attempt.executionId}`,
      ...attempt.stages.flatMap(stage => [`${stage.title}：${stage.label}${stage.detail ? ` · ${stage.detail}` : ""}`,
        ...stage.events.map(event => `记录 ${event.eventId} · ${adminObservationSource(event)} · ${event.outcome || "结果未记录"}`
          + (event.odds !== undefined ? ` · 记录赔率 @${event.odds}` : "")
          + (event.amount !== undefined ? ` · 金额 ${event.amount} ${event.currency || "币种未记录"}` : "")
          + (event.orderId ? ` · 订单 ${event.orderId}` : "")
          + (event.safeSummary ? ` · ${event.safeSummary}` : ""))]),
      ...attempt.orders.map(order => `当前订单 ${order.provider}/${order.playerId}/${order.orderId} · ${order.status} · @${order.odds}（状态更新时间未提供）`),
    ]),
    "原始执行、过程、监控与队列记录：",
    ...(data.observation?.events || []).map(event => [
      `记录 ${event.eventId} · ${event.kind} · 序号 ${event.sequence} · 完整 Link ${event.linkId}`,
      `执行 ${event.executionId || "未记录"} · 尝试 ${event.attemptId || "未记录"} · 父尝试 ${event.parentAttemptId || "未记录"} · 重试轮次 ${event.retryRound ?? "未记录"}`,
      `平台 ${event.provider || "系统"} · 主客 ${event.target || "未记录"} · 账号 ${event.accountId ?? "未记录"} · 订单 ${event.orderId || "未记录"}`,
      `队列 ${event.queueId || "未记录"} · 锚尝试 ${event.anchorAttemptId || "未记录"} · 锚订单 ${event.anchorOrderId || "未记录"}`,
      `来源 ${adminObservationSource(event)} · 结果 ${event.outcome || "未记录"} · 原始状态 ${event.observedStatus || "未记录"}`,
      `发生时间 ${event.occurredAt} · 服务端接收 ${event.receivedAt ?? "未记录"} · 耗时 ${event.durationMs ?? "未记录"}ms`,
      ...(event.odds !== undefined ? [`记录赔率 @${event.odds}`] : []),
      ...(event.amount !== undefined ? [`金额 ${event.amount} ${event.currency || "币种未记录"}`] : []),
      ...(event.planAmount !== undefined ? [`计划金额 ${event.planAmount}（原记录未标明单位）`] : []),
      ...(event.exchange !== undefined ? [`换算值 ${event.exchange}`] : []),
      ...(event.rate !== undefined ? [`记录费率 ${event.rate}`] : []),
      ...(event.httpStatus !== undefined ? [`HTTP ${event.httpStatus}`] : []),
      ...(event.responseCode ? [`返回码 ${event.responseCode}`] : []),
      ...(event.errorCategory ? [`异常类别 ${event.errorCategory}`] : []),
      ...(event.reasonCode ? [`原因 ${event.reasonCode}`] : []),
      ...(event.safeSummary ? [event.safeSummary] : []),
    ].join(" · ")),
    ...adminObservationIssues(data).map(issue => `核查提示：${issue}`),
  ].join("\n");
}
