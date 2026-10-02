import { insertOrderObservations } from "@changmen/db";
/** [changmen 扩展] 只输出旁路证据，不提供任何业务决策接口。 */
import { normalizeObservationEvent, OBSERVATION_TITLE } from "@changmen/shared/order_observation";

export async function saveObservationBatch(body, userId) {
  if (body.title !== OBSERVATION_TITLE)
    return null;
  try {
    if (typeof body.data !== "string" || body.data.length > 64_000)
      throw new Error("观察批次格式无效");
    const batch = JSON.parse(body.data);
    if (batch.ownerUserId !== userId || !Array.isArray(batch.events) || !batch.events.length || batch.events.length > 32)
      throw new Error("观察批次用户或数量无效");
    const events = batch.events.map(event => normalizeObservationEvent(event, userId));
    if (events.some(event => !event) || new Set(events.map(event => event?.eventId)).size !== events.length)
      throw new Error("观察事件格式无效");
    const accepted = await insertOrderObservations(userId, events);
    return { ok: true, info: { accepted } };
  }
  catch {
    return { ok: false, msg: "旁路观察写入失败" };
  }
}

export function summarizeOrderObservations(query) {
  if (query.status !== "available")
    return { ...query, mode: "shadow", issues: ["旁路事件不可用，保留原诊断"], attempts: [] };
  const byAttempt = new Map();
  const issues = query.truncated ? ["旁路事件已截断"] : [];
  for (const event of query.events) {
    if (event.kind === "transport_gap") {
      issues.push("客户端报告观察事件丢失");
      // 缺口沿用关联事件的序号，不是一次新的业务动作。
      continue;
    }
    if (!event.attemptId)
      continue;
    const list = byAttempt.get(event.attemptId) || [];
    list.push(event);
    byAttempt.set(event.attemptId, list);
  }
  const attempts = [...byAttempt].map(([attemptId, events]) => {
    events.sort((a, b) => a.sequence - b.sequence || a.eventId.localeCompare(b.eventId));
    const keys = new Set(events.map(event => event.sequence));
    const missingSequence = events.length > 0 && (Math.min(...keys) !== 1 || keys.size !== Math.max(...keys));
    const started = events.some(event => event.kind === "submission_started");
    const results = events.filter(event => event.kind === "submission_result");
    const settlements = events.filter(event => event.kind === "settlement_observed");
    const venueSettlements = settlements.filter(event => ["adapter", "ray_monitor"].includes(event.source) && ["filled", "unfilled"].includes(event.outcome));
    const findings = [];
    if (missingSequence || keys.size !== events.length)
      findings.push("事件序号缺失或冲突");
    if (started && !results.length)
      findings.push("已进入提交阶段，提交结果未知");
    if (results.some(event => event.outcome === "accepted") && !venueSettlements.length)
      findings.push("接口受理，缺少场馆确认事件");
    if (results.some(event => event.outcome === "accepted") && !events.some(event => event.kind === "bind_result" && event.outcome === "saved"))
      findings.push("缺少落库或绑定确认事件");
    if (new Set(events.map(event => event.linkId).filter(Boolean)).size > 1)
      findings.push("同一尝试出现多个非零 Link，关联存在冲突");
    if (settlements.some(event => event.source === "timeout_policy"))
      findings.push("业务按超时策略处理；不是官方拒单回执");
    if (settlements.some(event => event.source === "orchestration_result"))
      findings.push("仅有编排结果，缺少精确订单关联的场馆证据");
    const observations = new Set(venueSettlements.map(event => event.outcome));
    if (observations.has("filled") && observations.has("unfilled"))
      findings.push("场馆观察结果发生冲突，需核查原始事件");
    if (!events.some(event => event.kind === "precheck_started"))
      findings.push("缺少本次尝试的预检起点");
    if (events.some(event => event.kind === "precheck_started") && !events.some(event => event.kind === "precheck_result"))
      findings.push("缺少预检结果事件");
    if (events.some(event => event.kind === "submission_result" && event.outcome === "unknown"))
      findings.push("提交结果未知，不能认定未成交");
    return { attemptId, events, findings, evidence: "client_reported" };
  });
  const queueIds = new Set(query.events.map(event => event.queueId).filter(Boolean));
  const queues = [...queueIds].map((queueId) => {
    const events = query.events.filter(event => event.queueId === queueId);
    const findings = [];
    if (!events.some(event => event.kind === "queue_created"))
      findings.push("缺少队列创建事件");
    if (!events.some(event => ["queue_removed", "queue_canceled", "queue_replaced", "submission_started"].includes(event.kind)))
      findings.push("队列已创建，尚未观察到执行或关闭事件");
    return { queueId, events, findings };
  });
  for (const start of query.events.filter(event => event.kind === "execution_started")) {
    if (!query.events.some(event => event.kind === "execution_finished" && event.executionId === start.executionId))
      issues.push("缺少编排结束记录，不能判断执行是否仍在进行");
  }
  if (!query.events.length)
    issues.push("无旁路事件，不能据此认定未下单");
  return { ...query, mode: "shadow", issues: [...new Set(issues)], attempts, queues };
}
