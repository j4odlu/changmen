import type { OrderObservationEvent } from "./order_observation";

/** [changmen 扩展] 只读判定依据；不提供下注、拒单、补单或订单写入接口。 */
export interface ProgressOrderRecord {
  orderId: string;
  provider: string;
  accountId?: number;
  linkId?: number;
  status: string;
  shares?: number;
  side?: string;
}
export interface ProgressProof {
  rule: string;
  ruleVersion: 1;
  events: Readonly<OrderObservationEvent>[];
  records: Readonly<ProgressOrderRecord>[];
  missing: boolean;
}

/** 复制明确白名单。保留原 source、eventId 和时间，组合结论不得改写原事件。 */
export function progressProof(rule: string, events: readonly (OrderObservationEvent | undefined)[], records: readonly ProgressOrderRecord[] = []): ProgressProof {
  const seen = new Set<string>();
  const snapshots: Readonly<OrderObservationEvent>[] = [];
  for (const event of events) {
    if (!event || seen.has(`${event.ownerUserId}:${event.eventId}`)) continue;
    seen.add(`${event.ownerUserId}:${event.eventId}`);
    const copy: OrderObservationEvent = {
      version: 1, eventId: event.eventId, ownerUserId: event.ownerUserId, kind: event.kind,
      occurredAt: event.occurredAt, sequence: event.sequence, linkId: event.linkId,
    };
    for (const key of ["executionId", "attemptId", "parentAttemptId", "retryRound", "queueId", "anchorAttemptId", "anchorOrderId", "provider", "accountId", "orderId", "target", "phase", "outcome", "source", "reasonCode", "safeSummary", "observedStatus", "odds", "amount", "currency", "durationMs", "receivedAt", "responseCode", "httpStatus"] as const) {
      if (event[key] !== undefined) Object.assign(copy, { [key]: event[key] });
    }
    snapshots.push(Object.freeze(copy));
  }
  return {
    rule, ruleVersion: 1, events: snapshots,
    records: records.map(record => Object.freeze({ orderId: record.orderId, provider: record.provider,
      accountId: record.accountId, linkId: record.linkId, status: record.status, shares: record.shares, side: record.side })),
    missing: !snapshots.length && !records.length,
  };
}

const SETTLED: Record<string, string> = { win: "已结算 · 赢", lose: "已结算 · 输", draw: "已结算 · 和", void: "已结算 · 作废" };

/** 同一尝试重复预检时，旧结果不作为新检查的结果。 */
export function progressPrecheckEvidence(events: readonly OrderObservationEvent[]) {
  const started = [...events].reverse().find(event => event.kind === "precheck_started");
  const result = [...events].reverse().find(event => event.kind === "precheck_result");
  return { started, result: result && (!started || events.indexOf(result) > events.indexOf(started)) ? result : undefined };
}

export function blockedExecutionEvidence(events: readonly OrderObservationEvent[], executionEvents: readonly OrderObservationEvent[]) {
  if (events.some(event => ["submission_started", "submission_result"].includes(event.kind))) return undefined;
  return executionEvents.find(event => event.kind === "execution_finished" && event.phase === "check" && event.outcome === "blocked"
    && Boolean(event.executionId) && events.some(fact => fact.executionId === event.executionId
      && fact.ownerUserId === event.ownerUserId && fact.linkId === event.linkId));
}

export function progressPrecheck(events: readonly OrderObservationEvent[]) {
  const { result, started } = progressPrecheckEvidence(events);
  return {
    label: result?.outcome === "prepared" ? "预检通过" : result?.outcome === "blocked" ? "预检失败"
      : result?.outcome === "inconsistent" ? "预检结果不一致" : result ? "预检结果未明确" : started ? "正在预检" : "预检结果未记录",
    proof: progressProof(`precheck.${result?.outcome || "pending"}`, [result || started]),
  };
}

/** 仅判定有明确事件依据的提交状态；缺少记录时交给页面显示缺口或编排提示。 */
export function progressSubmission(events: readonly OrderObservationEvent[], executionEvents: readonly OrderObservationEvent[] = []) {
  const submit = [...events].reverse().find(event => event.kind === "submission_result");
  const started = [...events].reverse().find(event => event.kind === "submission_started");
  const { result: check } = progressPrecheckEvidence(events);
  const blocked = blockedExecutionEvidence(events, executionEvents);
  if (!submit && !started && (check?.outcome === "blocked" || blocked))
    return { label: "未提交", proof: progressProof("submission.explicitly_blocked", [check, blocked]) };
  if (!submit && !started) return undefined;
  const direct = submit?.provider === "Polymarket" && submit.outcome === "accepted" && submit.observedStatus === "matched";
  return { label: submit?.outcome === "accepted" ? direct ? "直接成交" : submit.observedStatus === "delayed" ? "delayed · 已受理待检测" : "接口已受理"
    : submit?.outcome === "adapter_failed" ? "提交返回失败" : submit?.outcome === "unknown" ? "提交结果未知"
      : submit?.outcome === "not_submitted" ? "未提交" : submit ? "提交结果未明确" : "提交处理中",
    proof: progressProof(`submission.${submit?.outcome || "started"}`, [submit || started]) };
}

export function progressBinding(events: readonly OrderObservationEvent[]) {
  const bind = [...events].reverse().find(event => event.kind === "bind_result");
  if (!bind) return undefined;
  return { label: bind.outcome === "saved" ? "已保存" : bind.outcome === "failed" ? "绑定失败" : "绑定结果未明确",
    proof: progressProof(`binding.${bind.outcome || "unknown"}`, [bind]) };
}

/** 订单记录来自调用方已按用户隔离的查询；None 占位订单不作为成交依据。 */
export function delayedPmConfirmation(events: readonly OrderObservationEvent[], orders: readonly ProgressOrderRecord[] = []) {
  const submit = [...events].reverse().find(event => event.kind === "submission_result");
  if (submit?.provider !== "Polymarket" || !(submit.observedStatus === "delayed" || submit.outcome === "unknown")) return undefined;
  const records = orders.filter(order => submit.orderId && submit.accountId !== undefined
    && order.orderId === submit.orderId && order.provider === "Polymarket"
    && order.accountId === submit.accountId && order.linkId === submit.linkId && order.side !== "sell"
    && Number.isFinite(order.shares) && Number(order.shares) > 0
    && ["none", "win", "lose", "draw", "void"].includes(order.status.toLowerCase()));
  const matching = events.filter(event => event.kind === "settlement_observed"
    && event.ownerUserId === submit.ownerUserId && event.attemptId === submit.attemptId
    && (!submit.executionId || event.executionId === submit.executionId)
    && Boolean(submit.orderId) && event.orderId === submit.orderId && event.provider === "Polymarket"
    && (submit.accountId === undefined || event.accountId === submit.accountId));
  const venue = matching.filter(event => ["adapter", "order_record"].includes(event.source || ""));
  const status = (event: OrderObservationEvent) => event.observedStatus?.trim().toLowerCase();
  const fills = venue.filter(event => event.outcome === "filled" && ["none", "matched", "mined", "confirmed", "win", "lose", "draw", "void"].includes(status(event) || ""));
  const rejects = venue.filter(event => event.outcome === "unfilled" && ["reject", "canceled", "cancelled", "expired"].includes(status(event) || ""));
  const terminal = [...fills, ...rejects];
  const confirmed = [...venue].reverse().find(event => terminal.includes(event));
  const policy = [...matching].reverse().find(event => event.source === "timeout_policy");
  const evidence = confirmed || policy || venue.at(-1);
  const detail = submit.orderId
    ? `PM 订单 ${submit.orderId}${evidence?.observedStatus ? ` · 订单状态 ${evidence.observedStatus}` : " · 尚无明确订单状态"}`
    : "本次提交未记录 PM 订单号，无法关联订单状态";
  if (fills.length && rejects.length)
    return { label: "订单确认记录冲突", tone: "warning" as const, basis: detail, event: evidence,
      proof: progressProof("pm.conflicting_receipts", [submit, ...terminal]) };
  if (records.length === 1) {
    const record = records[0]!;
    const state = record.status.toLowerCase();
    if (rejects.length)
      return { label: "订单确认记录冲突", tone: "warning" as const, basis: `${detail} · 当前订单记录另有成交份额`, event: evidence,
        proof: progressProof("pm.record_receipt_conflict", [submit, ...rejects], [record]) };
    if (state !== "none" || !SETTLED[confirmed ? status(confirmed) || "" : ""])
      return { label: state === "none" ? "订单已成交 · 未结算" : SETTLED[state]!, tone: "success" as const,
        basis: `PM 订单 ${submit.orderId} · 当前订单状态 ${record.status} · 成交份额 ${record.shares}（状态更新时间未提供）`, event: undefined,
        proof: progressProof("pm.current_order_record", [submit], [record]) };
  }
  if (confirmed) {
    const state = status(confirmed)!;
    return { label: confirmed.outcome === "unfilled" ? state === "reject" ? "订单未成交 · 拒单" : state === "expired" ? "订单未成交 · 已过期" : "订单未成交 · 已取消"
      : state === "none" ? "订单已成交 · 未结算" : SETTLED[state] || "订单已成交",
      tone: confirmed.outcome === "unfilled" ? "danger" as const : "success" as const, basis: detail, event: confirmed,
      proof: progressProof("pm.order_receipt", [submit, confirmed]) };
  }
  if (policy)
    return { label: "超时策略处理", tone: "warning" as const, basis: `${detail} · 本地超时处理，不代表场馆取消或拒单`, event: policy,
      proof: progressProof("pm.timeout_policy", [submit, policy]) };
  return { label: "订单待确认", tone: "pending" as const, basis: detail, event: evidence || submit,
    proof: progressProof("pm.awaiting_order_confirmation", [submit, evidence]) };
}

/** 旧 RAY 记录的补充判定独立于原事件；当前订单状态没有历史更新时间。 */
export function boundRayOrderConfirmation(events: readonly OrderObservationEvent[], orders: readonly ProgressOrderRecord[]) {
  const settlement = [...events].reverse().find(event => event.provider === "RAY" && event.kind === "settlement_observed"
    && event.source === "orchestration_result" && event.outcome === "unfilled" && event.attemptId && event.accountId);
  if (!settlement) return undefined;
  const bindings = events.filter(bind => bind.kind === "bind_result" && bind.outcome === "saved" && bind.orderId
    && bind.source !== "ray_bind_api_ack" && bind.ownerUserId === settlement.ownerUserId
    && bind.attemptId === settlement.attemptId && bind.linkId === settlement.linkId
    && bind.provider === "RAY" && bind.accountId === settlement.accountId
    && (!settlement.executionId || bind.executionId === settlement.executionId));
  const ids = new Set(bindings.map(bind => bind.orderId));
  if (ids.size !== 1) return undefined;
  const orderId = [...ids][0]!;
  if (settlement.orderId && settlement.orderId !== orderId) return undefined;
  const matches = orders.filter(order => order.orderId === orderId && order.provider === "RAY"
    && order.linkId === settlement.linkId && order.accountId === settlement.accountId);
  if (matches.length !== 1 || matches[0]?.status !== "Reject") return undefined;
  const contrary = events.filter(event => event.kind === "settlement_observed" && event.ownerUserId === settlement.ownerUserId
    && event.attemptId === settlement.attemptId && event.provider === "RAY" && event.accountId === settlement.accountId
    && event.orderId === orderId && ["adapter", "ray_monitor", "order_record"].includes(event.source || "")
    && event.outcome === "filled" && ["win", "lose", "draw", "void"].includes(event.observedStatus?.toLowerCase() || ""));
  if (contrary.length)
    return { label: "确认记录冲突", tone: "danger" as const, basis: "当前订单拒单状态与历史结算记录冲突", orderId,
      proof: progressProof("ray.record_receipt_conflict", [settlement, ...bindings, ...contrary], matches) };
  return { label: "检测到拒单", tone: "danger" as const, basis: "已绑定订单当前状态为拒单", orderId,
    proof: progressProof("ray.bound_current_rejection", [settlement, ...bindings], matches) };
}
