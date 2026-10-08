import type { OrderObservationEvent } from "@changmen/shared/order_observation";
import type { ActiveBetLeg, ActiveBetLegStatus, ActiveBetRun } from "@/types/activeBetRun";
import type { OrderRow } from "@/types/order";
import { classifyLinkId } from "@changmen/client-core/shared/format";
import { observationEventLabel, orderObservationTargets } from "@changmen/shared/order_observation_view";
import { pmOrderConfirmation } from "./pmOrderConfirmation";
import { boundRayOrderEvidence } from "./boundRayOrderEvidence";
import { progressPrecheckEvidence, progressPrecheck, progressProof } from "@changmen/shared/order_progress_evidence";

export type ProgressTone = "neutral" | "pending" | "success" | "warning" | "danger";
const FALLBACK_LABELS: Record<ActiveBetLegStatus, string> = {
  pending: "待处理",
  placing: "提交中",
  submitted: "已提交",
  pending_confirm: "待确认",
  confirmed: "已成交",
  rejected: "拒单",
  failed: "失败",
  makeup: "补单中",
  skipped: "不参与",
};

/** [changmen 扩展] 模式由本次启动参数确定；恢复记录可用 Link 编码兜底，不能按剩余腿数猜测。 */
export function activeBetRunMode(run: Pick<ActiveBetRun, "mode" | "linkId">) {
  const source = classifyLinkId(run.linkId);
  return run.mode ?? (source === "single" ? "single9999" : source === "arb" ? "arb" : source === "valueBet" ? "valueBet" : undefined);
}

export function activeBetRunModeLabel(run: Pick<ActiveBetRun, "mode" | "linkId">): string {
  const mode = activeBetRunMode(run);
  return mode === "single9999" ? "9999 单边下单" : mode === "arb" ? "双边套利" : mode === "valueBet" ? "正EV 单腿下单" : "模式未记录";
}

export function activeBetLegRole(leg: ActiveBetLeg): string {
  if (leg.precheckOnly || leg.detail?.includes("9999仅预检"))
    return "仅预检 · 不下单";
  return leg.status === "skipped" ? "不参与" : "下单腿";
}

/** [changmen 扩展] 同一尝试再次开始预检时，旧结果不能充当新检查的结果。 */
export function observationPrecheckEvidence(events: readonly OrderObservationEvent[]) {
  return progressPrecheckEvidence(events);
}

/** [changmen 扩展] 只读展示最近尝试；受理、超时策略与场馆成交证据分开。 */
export function observationLegSummary(events: readonly OrderObservationEvent[], fallback: ActiveBetLegStatus, precheckOnly = false, orders: readonly OrderRow[] = []) {
  // 老尝试的补绑回执可能晚于新重试到达，按尝试首次出现排序，不能按最后一条回执选尝试。
  const attempts = new Set(events.map(event => event.attemptId).filter(Boolean));
  const lastAttempt = [...attempts].at(-1);
  const attempt = lastAttempt ? events.filter(event => event.attemptId === lastAttempt) : events;
  const matching = (kind: OrderObservationEvent["kind"]) => [...attempt].reverse().find(event => event.kind === kind);
  const observed = attempt.filter(event => event.kind === "settlement_observed"
    && ["adapter", "ray_monitor", "order_record"].includes(event.source || "") && ["filled", "unfilled"].includes(event.outcome || ""));
  // RAY 的 none 表示检测时未拒单，后续同订单拒单是状态更新，不是终态冲突。
  const confirmations = observed.filter((event, index) => !(event.provider === "RAY" && event.observedStatus === "none"
    && event.orderId && observed.slice(index + 1).some(next => next.orderId === event.orderId && next.observedStatus === "reject")));
  const outcomes = new Set(confirmations.map(event => event.outcome));
  const submission = matching("submission_result");
  const { result: check, started: checkStarted } = observationPrecheckEvidence(attempt);
  // [changmen 扩展] 预检结果常驻展示，与后续提交/确认状态分开；只使用最近尝试的证据。
  const precheck = {
    label: progressPrecheck(attempt).label,
    tone: (check?.outcome === "prepared" ? "success"
      : check?.outcome === "blocked" ? "danger"
        : check ? "warning" : checkStarted ? "pending" : "neutral") as ProgressTone,
    at: (check || checkStarted)?.occurredAt,
    durationMs: check?.durationMs,
    basis: check ? observationEventLabel(check) : checkStarted ? "等待预检结果记录" : "本次尝试尚无预检结果记录",
  };
  const policy = attempt.some(event => event.kind === "settlement_observed" && event.source === "timeout_policy");
  const evidence = [...attempt].reverse().find(event => event.safeSummary);
  let label = fallback === "confirmed" ? "编排判定成交 · 缺少场馆确认记录" : `编排：${FALLBACK_LABELS[fallback]}`;
  if (precheckOnly)
    label = fallback === "failed" ? "9999 仅预检 · 失败" : "9999 仅预检 · 不下单";
  let tone: ProgressTone = "neutral";
  let basis = "尚无本次尝试的结果证据";
  if (outcomes.size > 1) {
    label = "确认记录冲突"; tone = "danger"; basis = "同时记录成交与未成交，需要核查";
  }
  else if (outcomes.has("filled")) {
    const notRejected = confirmations.at(-1)?.provider === "RAY" && confirmations.at(-1)?.observedStatus === "none";
    label = notRejected ? "拒单检测通过 · 未拒单" : "观察到成交";
    tone = "success"; basis = notRejected ? "检测时场馆订单状态为未结算，未发现拒单" : "场馆订单关联的确认记录";
  }
  else if (outcomes.has("unfilled")) {
    label = confirmations.some(event => event.observedStatus === "reject") ? "检测到拒单" : "观察到未成交";
    tone = "danger"; basis = confirmations.some(event => event.source === "order_record") ? "已绑定订单当前状态为拒单" : "场馆订单关联的拒单检测记录";
  }
  else if (policy) {
    label = "超时策略处理"; tone = "warning"; basis = "仍缺少场馆终态，不能认定官方拒单";
  }
  else if (submission?.outcome === "accepted") {
    const direct = submission.provider === "Polymarket" && submission.observedStatus === "matched";
    label = direct ? "直接成交" : "已受理 · 待确认"; tone = direct ? "success" : "pending";
    basis = direct ? "PM 提交返回 matched" : "接口受理尚不证明成交";
  }
  else if (submission?.outcome === "unknown") {
    label = "提交结果未知"; tone = "warning"; basis = "不能据此认定未成交";
  }
  else if (submission?.outcome === "adapter_failed") {
    label = "提交返回失败"; tone = "danger"; basis = "适配器失败尚不证明未成交";
  }
  else if (check?.outcome === "blocked" && matching("submission_started") && !submission) {
    label = "结果待核查"; tone = "warning"; basis = "预检被拦截，但已有提交起点，缺少返回记录";
  }
  else if (submission?.outcome === "not_submitted" || check?.outcome === "blocked") {
    label = "本次未提交"; tone = "warning"; basis = evidence?.safeSummary || "预检或提交条件未通过";
  }
  else if (matching("submission_started")) {
    label = "提交处理中"; tone = "pending"; basis = "已调用适配器，等待返回";
  }
  else if (check?.outcome === "inconsistent") {
    label = "预检结果需核查"; tone = "warning"; basis = check.safeSummary || "预检同时返回盘口数据和错误，无法认定已拦截";
  }
  else if (check?.outcome === "prepared") {
    label = precheckOnly ? "9999 预检通过 · 不下单" : "预检通过";
    tone = "pending"; basis = precheckOnly ? "本侧仅预检，对侧允许真实下单" : "尚未记录提交结果";
  }
  else if (matching("precheck_started")) {
    label = "预检处理中"; tone = "pending"; basis = "等待盘口和下注条件校验";
  }
  const amountEvent = [...attempt].reverse().find(event => event.amount !== undefined);
  // [changmen 扩展] 失败原因直接展示；历史通用错误只说明记录缺失，不推断场馆故障。
  const failure = [...confirmations].reverse().find(event => event.outcome === "unfilled" && event.safeSummary) || (submission && ["adapter_failed", "unknown", "not_submitted"].includes(submission.outcome || "")
    ? submission : !submission && check?.outcome === "blocked" ? check : undefined);
  const failureSummary = failure?.provider === "RAY" && failure.responseCode
    && failure.safeSummary === "执行失败，未记录可识别的具体原因"
    ? "该次记录未保留场馆错误说明" : failure?.safeSummary;
  const failureReason = failureSummary
    ? `${failureSummary}${failure?.responseCode && !failureSummary.includes(`业务码 ${failure.responseCode}`) ? `（场馆业务码 ${failure.responseCode}）` : ""}`
    : undefined;
  const money = amountEvent?.amount ?? undefined;
  const pmConfirmation = pmOrderConfirmation(attempt, orders);
  const rayConfirmation = boundRayOrderEvidence(attempt, orders);
  if (pmConfirmation) {
    label = pmConfirmation.label;
    tone = pmConfirmation.tone;
    basis = pmConfirmation.basis;
  }
  else if (rayConfirmation) {
    label = rayConfirmation.label;
    tone = rayConfirmation.tone;
    basis = rayConfirmation.basis;
  }
  const numberLabel = (value: number) => value.toLocaleString("zh-CN", { maximumFractionDigits: 4 });
  const proof = pmConfirmation?.proof || rayConfirmation?.proof || progressProof("leg.summary", confirmations.length ? confirmations
    : policy ? attempt.filter(event => event.source === "timeout_policy") : [submission || check || checkStarted]);
  return {
    provider: pmConfirmation ? submission?.provider : [...attempt].reverse().find(event => event.provider)?.provider,
    precheck,
    label,
    tone,
    basis,
    proof,
    failureReason,
    attemptId: lastAttempt,
    orderId: pmConfirmation ? submission?.orderId : rayConfirmation?.orderId || [...attempt].reverse().find(event => event.orderId)?.orderId,
    accountId: pmConfirmation ? submission?.accountId : [...attempt].reverse().find(event => event.accountId)?.accountId,
    amount: money === undefined ? undefined : `${numberLabel(money)} ${amountEvent?.currency || "（币种未记录）"}`,
    odds: [...attempt].reverse().find(event => event.odds !== undefined)?.odds,
    bound: attempt.some(event => event.kind === "bind_result" && event.outcome === "saved"
      && (!pmConfirmation || Boolean(submission?.orderId) && event.orderId === submission?.orderId
        && event.provider === submission?.provider && (submission?.accountId === undefined || event.accountId === submission.accountId))),
    retries: new Set(events.filter(event => event.retryRound && event.attemptId).map(event => event.attemptId)).size,
    makeups: new Set(events.filter(event => event.kind === "queue_created" && event.queueId).map(event => event.queueId)).size,
  };
}

/** [changmen 扩展] 编排成功不能代替场馆成交证据，9999 预检身份独立于可变 detail。 */
export function progressOrchestrationLabel(leg: Pick<ActiveBetLeg, "status" | "precheckOnly">, events: readonly OrderObservationEvent[], fallbackLabel: string, orders: readonly OrderRow[] = []): string {
  if (leg.precheckOnly)
    return leg.status === "failed" ? "9999 仅预检 · 失败" : "9999 仅预检 · 不下单";
  if (leg.status === "confirmed") {
    const summary = observationLegSummary(events, leg.status, leg.precheckOnly, orders);
    if (summary.label === "检测到拒单")
      return "编排曾判定成交 · 后续检测到拒单";
    if (summary.tone !== "success")
      return summary.label === "确认记录冲突" ? "编排曾判定成交 · 确认记录冲突" : "编排判定成交 · 缺少场馆确认记录";
  }
  return fallbackLabel;
}

export function progressEvidenceWarnings(events: readonly OrderObservationEvent[]): string[] {
  const warnings: string[] = [];
  if (events.some(event => event.kind === "precheck_result" && event.outcome === "inconsistent"))
    warnings.push("预检返回同时包含盘口数据与错误，请核对对应尝试的提交记录");
  if (events.some(event => event.kind === "transport_gap"))
    warnings.push("执行记录存在上传或缓存缺口");
  const attempts = new Map<string, Set<number>>();
  for (const event of events) {
    if (!event.attemptId || event.kind === "transport_gap")
      continue;
    const sequences = attempts.get(event.attemptId) || new Set<number>();
    if (sequences.has(event.sequence))
      warnings.push("执行记录序号冲突");
    sequences.add(event.sequence);
    attempts.set(event.attemptId, sequences);
  }
  for (const sequences of attempts.values()) {
    if (Math.min(...sequences) !== 1 || sequences.size !== Math.max(...sequences))
      warnings.push("部分执行事件缺失");
  }
  return [...new Set(warnings)];
}

/** [changmen 扩展] 只凭事件方向或唯一尝试归属分组，整单和歧义记录完整保留。 */
export function observationLegGroups(events: readonly OrderObservationEvent[], legs: readonly Pick<ActiveBetLeg, "side" | "target">[]) {
  const targets = orderObservationTargets(events);
  const groups = new Map(legs.map(leg => [leg.side, events.filter(event => targets.get(event) === leg.target)]));
  const unassigned = events.filter(event => !legs.some(leg => targets.get(event) === leg.target));
  return { groups, unassigned };
}
