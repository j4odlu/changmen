import type { OrderObservationEvent } from "@changmen/shared/order_observation";
import type { ActiveBetLeg, ActiveBetRun } from "@/types/activeBetRun";
import type { OrderRow } from "@/types/order";
import type { ProgressTone } from "./activeBetRunPresentation";
import { observationEventLabel } from "@changmen/shared/order_observation_view";
import { observationLegSummary, observationPrecheckEvidence, progressOrchestrationLabel } from "./activeBetRunPresentation";
import { pmOrderConfirmation } from "./pmOrderConfirmation";
import { boundRayOrderEvidence } from "./boundRayOrderEvidence";
import { progressProof, progressPrecheck, progressSubmission, progressBinding, blockedExecutionEvidence, type ProgressProof } from "@changmen/shared/order_progress_evidence";

export interface BetProgressStage {
  id: string;
  stage: string;
  label: string;
  tone: ProgressTone;
  at?: number;
  durationMs?: number;
  odds?: number;
  detail?: string;
  proof?: ProgressProof;
}

/** [changmen 扩展] 首轮与后续尝试分别展示；旧尝试迟到回执不能改变最新尝试归属。 */
export function activeBetLegAttemptViews(run: ActiveBetRun, leg: ActiveBetLeg, events: readonly OrderObservationEvent[]) {
  const ids = [...new Set(events.map(event => event.attemptId).filter((id): id is string => Boolean(id)))];
  let makeup = 0;
  let retry = 0;
  let initial = 0;
  let unknown = 0;
  const attempts = ids.map(id => {
    const facts = events.filter(event => event.attemptId === id);
    const phase = facts.find(event => ["initial", "retry", "makeup"].includes(event.phase || ""))?.phase;
    if (phase === "retry")
      retry = facts.find(event => event.retryRound)?.retryRound || retry + 1;
    const label = phase === "initial" ? "首轮尝试"
      : phase === "makeup" ? `补单第 ${++makeup} 次`
        : phase === "retry" ? `即时重试第 ${retry} 次` : "尝试类型未记录";
    const key = phase === "initial" ? `initial:${++initial}`
      : phase === "makeup" ? `makeup:${makeup}` : phase === "retry" ? `retry:${retry}` : `unknown:${leg.side}:${++unknown}`;
    // 历史尝试只取自身证据，不继承最新腿状态、队列或整轮编排结论。
    const stages = activeBetLegStages(run, { ...leg, status: "pending", events: [] }, facts)
      .filter(stage => ["precheck", "submission"].includes(stage.id)
        || (["binding", "confirmation"].includes(stage.id) && stage.at !== undefined));
    const provider = facts.find(event => event.provider)?.provider;
    return { id, key, label, provider: provider === "Polymarket" ? "PM" : provider, stages };
  });
  return { latestLabel: attempts.at(-1)?.label || "尝试类型未记录", previous: attempts.slice(0, -1), attempts };
}

/** [changmen 扩展] 关键阶段常驻展示；尝试内证据、补单队列和整轮编排分别取值，不参与下注判定。 */
export function activeBetLegStages(run: ActiveBetRun, leg: ActiveBetLeg, events: readonly OrderObservationEvent[], orders: readonly OrderRow[] = [], executionEvents: readonly OrderObservationEvent[] = []): BetProgressStage[] {
  const summary = observationLegSummary(events, leg.status, leg.precheckOnly, orders);
  const attempt = summary.attemptId ? events.filter(event => event.attemptId === summary.attemptId) : events;
  const last = (kind: OrderObservationEvent["kind"]) => [...attempt].reverse().find(event => event.kind === kind);
  const fromEvent = (id: string, stage: string, label: string, tone: ProgressTone, event?: OrderObservationEvent): BetProgressStage => ({
    id, stage, label, tone, at: event?.occurredAt, durationMs: event?.durationMs,
    detail: event ? observationEventLabel(event) : undefined,
    proof: progressProof(`${id}.${event?.outcome || event?.kind || "missing"}`, [event]),
  });
  const { result: check } = observationPrecheckEvidence(attempt);
  const submit = last("submission_result");
  const submitStarted = last("submission_started");
  // [changmen 扩展] 整轮在预检阶段结束时，预检通过的对腿也未提交；仅关联同一执行，不借用其他轮的结束记录。
  const executionIds = new Set(attempt.map(event => event.executionId).filter(Boolean));
  const blockedExecution = blockedExecutionEvidence(attempt, executionEvents);
  const blockedBeforeSubmission = !submit && !submitStarted && Boolean(blockedExecution);
  const directPm = submit?.provider === "Polymarket" && submit.outcome === "accepted" && submit.observedStatus === "matched";
  const detecting = attempt.some(event => event.source !== "ray_monitor" && (event.reasonCode === "reject_detection_started" || event.phase === "reject_detection"));
  const detectionStage = (submit?.provider || leg.platform) !== "Polymarket" || submit?.observedStatus === "delayed" || detecting;
  const noBet = !submit && !submitStarted && (leg.precheckOnly || leg.status === "skipped");
  const notSubmitted = blockedBeforeSubmission || (!submitStarted && !submit && check?.outcome === "blocked")
    || submit?.outcome === "not_submitted";
  const early = !run.terminalAt && ["preparing", "checking"].includes(run.phase);
  const precheck: BetProgressStage = { id: "precheck", stage: "预检", ...summary.precheck, detail: check && ["blocked", "inconsistent"].includes(check.outcome || "") ? summary.precheck.basis : undefined };
  precheck.proof = progressPrecheck(attempt).proof;
  // [changmen 扩展] 赔率只取本轮有效预检结果，避免提交、补单或实时赔率覆盖历史预检快照。
  if (check?.odds !== undefined && Number.isFinite(check.odds) && check.odds > 0)
    precheck.odds = check.odds;
  if (!last("precheck_started") && !check) {
    if (leg.status === "skipped")
      precheck.label = "不参与";
    else if (early)
      precheck.label = "等待预检";
  }

  const submissionFact = progressSubmission(attempt, executionEvents);
  const submission = fromEvent("submission", "提交下注",
    submissionFact?.label ?? (noBet ? leg.precheckOnly ? "仅预检 · 不下单" : "不参与" : early ? "等待提交" : "提交记录缺失"),
    submit?.outcome === "accepted" ? "success" : submit?.outcome === "adapter_failed" ? "danger"
      : submit ? "warning" : submitStarted ? "pending" : "neutral", submit || submitStarted);
  // 接口受理只完成提交阶段，确认阶段必须继续显示待确认。
  if (submit?.outcome === "accepted")
    submission.detail = directPm ? "PM 提交返回 matched，直接成交" : "接口受理尚不证明成交";
  else if (summary.failureReason && submit)
    submission.detail = summary.failureReason;
  if (blockedBeforeSubmission)
    submission.detail = "本轮预检未通过，整轮已拦截，未进入场馆下注处理";
  if (submissionFact)
    submission.proof = submissionFact.proof;

  // [changmen 扩展] 定时检测和独立监控分别展示，监控结果不能覆盖第一次检测记录。
  const detectionEvents = attempt.filter(event => event.source !== "ray_monitor");
  const detectionSummary = observationLegSummary(detectionEvents, leg.status, leg.precheckOnly);
  const settlements = detectionEvents.filter(event => event.kind === "settlement_observed");
  const observed = settlements.filter(event => ["adapter", "order_record"].includes(event.source || "")
    && ["filled", "unfilled"].includes(event.outcome || ""));
  const venue = observed.filter((event, index) => !(event.provider === "RAY" && event.observedStatus === "none"
    && event.orderId && observed.slice(index + 1).some(next => next.orderId === event.orderId && next.observedStatus === "reject")));
  const policy = settlements.find(event => event.source === "timeout_policy");
  const orchestration = [...settlements].reverse().find(event => event.source === "orchestration_result");
  const evidence = venue.at(-1) || policy || orchestration || settlements.at(-1);
  const venueOutcomes = new Set(venue.map(event => event.outcome));
  const confirmationLabel = venueOutcomes.size > 1 ? "确认记录冲突"
    : venueOutcomes.has("filled") ? detectionSummary.label : venueOutcomes.has("unfilled") ? evidence?.observedStatus === "reject" ? "检测到拒单" : "观察到未成交"
      : policy ? "超时策略处理" : orchestration ? `编排判定${orchestration.outcome === "filled" ? "成交" : orchestration.outcome === "unfilled" ? "未成交" : "待确认"} · 缺少场馆确认记录` : undefined;
  const confirmation = fromEvent("confirmation", detectionStage ? "拒单检测" : "成交确认",
    confirmationLabel ?? (noBet ? "不参与" : notSubmitted ? "未进入确认"
        : detecting ? "正在拒单检测" : evidence || submit?.outcome === "accepted" || submit?.outcome === "unknown" ? "待场馆确认"
          : submit?.outcome === "adapter_failed" ? "确认记录缺失" : "等待确认"),
    venueOutcomes.size > 1 || venueOutcomes.has("unfilled") ? "danger" : venueOutcomes.has("filled") ? "success"
      : policy || orchestration ? "warning"
        : evidence || submit?.outcome === "accepted" || submit?.outcome === "unknown" ? "pending" : "neutral", evidence);
  confirmation.proof = progressProof("confirmation.observation", [submit, ...(venue.length ? venue : [evidence]),
    notSubmitted ? check : undefined, blockedBeforeSubmission ? blockedExecution : undefined]);
  if (policy || orchestration || venue.length)
    confirmation.detail = venue.length ? [detectionSummary.basis, detectionSummary.failureReason].filter(Boolean).join(" · ") : policy ? "仍缺少场馆终态，不能认定官方拒单" : "编排判定不代替场馆订单确认";
  const pmConfirmation = pmOrderConfirmation(detectionEvents, orders);
  if (pmConfirmation) {
    confirmation.stage = "订单状态";
    confirmation.label = pmConfirmation.label;
    confirmation.tone = pmConfirmation.tone;
    confirmation.detail = pmConfirmation.basis;
    confirmation.at = pmConfirmation.event?.occurredAt;
    confirmation.durationMs = pmConfirmation.event?.durationMs;
    confirmation.proof = pmConfirmation.proof;
  }
  const rayConfirmation = boundRayOrderEvidence(detectionEvents, orders);
  if (!pmConfirmation && rayConfirmation) {
    confirmation.label = rayConfirmation.label;
    confirmation.tone = rayConfirmation.tone;
    confirmation.detail = `${rayConfirmation.basis}（状态更新时间未提供）`;
    confirmation.at = undefined;
    confirmation.durationMs = undefined;
    confirmation.proof = rayConfirmation.proof;
  }
  const isRay = (submit?.provider || summary.provider || leg.platform) === "RAY";
  if (isRay)
    confirmation.detail = ["按配置的固定等待时间检测", confirmation.detail].filter(Boolean).join(" · ");
  const monitorEvent = [...attempt].reverse().find(event => event.source === "ray_monitor");
  const monitorRejected = monitorEvent?.kind === "settlement_observed" && monitorEvent.outcome === "unfilled";
  const monitorClosed = monitorEvent?.kind === "settlement_observed" && monitorEvent.outcome === "filled";
  const monitorExpired = monitorEvent?.outcome === "expired";
  const monitor = fromEvent("ray_monitor", "RAY订单监控",
    monitorRejected ? "监控检测到拒单" : monitorClosed ? "订单已结算 · 监控结束"
      : monitorExpired ? "监控窗口已结束"
        : monitorEvent?.outcome === "bound" ? "持续监控中"
          : monitorEvent ? "已登记 · 等待关联订单"
            : noBet || notSubmitted ? "不参与"
              : venueOutcomes.has("unfilled") ? "未启动 · 定时检测已拒单"
                : run.terminalAt ? "未记录监控登记" : "等待定时检测后登记",
    monitorRejected ? "danger" : monitorClosed ? "success" : monitorEvent && !monitorExpired ? "pending" : "neutral", monitorEvent);
  if (monitorEvent)
    monitor.detail = ["独立监控后续拒单", monitorEvent.safeSummary].filter(Boolean).join(" · ");
  else if (notSubmitted)
    monitor.proof = submission.proof;

  const bind = last("bind_result");
  const binding = fromEvent("binding", "绑定订单", bind?.outcome === "saved" ? "已保存"
    : bind?.outcome === "failed" ? "绑定失败" : bind ? "绑定结果未明确"
      : noBet || notSubmitted ? "不参与" : "尚无绑定回执",
  bind?.outcome === "saved" ? "success" : bind?.outcome === "failed" ? "danger" : "neutral", bind);
  const bindingFact = progressBinding(attempt);
  if (bindingFact) binding.proof = bindingFact.proof;
  if (!bind && notSubmitted)
    binding.proof = submission.proof;

  // 按队列首次出现选最新队列，旧队列迟到的出队记录不能覆盖新补单。
  const queues = [...new Set(events.filter(event => event.kind.startsWith("queue_")).map(event => event.queueId).filter(Boolean))];
  const queueId = queues.at(-1);
  const queue = [...events].reverse().find(event => event.kind.startsWith("queue_") && (!queueId || event.queueId === queueId));
  const makeup = fromEvent("makeup", "补单", queue?.kind === "queue_created" ? "已入补单队列"
    : queue?.kind === "queue_removed" ? "已出补单队列"
      : queue?.kind === "queue_canceled" ? "补单已取消"
        : queue?.kind === "queue_replaced" ? "补单任务已替换" : noBet ? "不参与" : "尚无补单记录",
  queue?.kind === "queue_created" ? "pending" : "neutral", queue);
  if (queue?.kind === "queue_removed")
    makeup.detail = "出队记录不代表补单成交，请核查场馆确认";
  const localMakeup = [...leg.events].reverse().find(event => event.stage === "补单");
  if (localMakeup) {
    makeup.detail = [makeup.detail, `编排：${localMakeup.detail}`].filter(Boolean).join(" · ");
    if (!queue || localMakeup.detail.includes("自动补单已关闭")) {
      makeup.label = `编排：${localMakeup.detail}`;
      makeup.detail = queue ? observationEventLabel(queue) : undefined;
      makeup.at = localMakeup.at;
      makeup.tone = localMakeup.detail.includes("自动补单已关闭") ? "warning" : "neutral";
      makeup.proof = progressProof("makeup.local_orchestration", []);
    }
  }

  const stages = [precheck, submission, binding, ...(directPm ? [] : [confirmation]), ...(isRay ? [monitor] : []), makeup];
  // 无观察事件的旧记录仍展示已有编排阶段，明确来源，不把编排标签升级为场馆证据。
  if (!events.length) {
    for (const [id, layer] of [["precheck", "预检"], ["submission", "下单"], ["confirmation", "拒单"]] as const) {
      const local = [...leg.events].reverse().find(event => event.stage === layer && !event.detail.includes("绑单"));
      const row = stages.find(stage => stage.id === id);
      if (local && row) {
        row.label = `编排：${local.detail}`;
        row.at = local.at;
        row.tone = "neutral";
        row.proof = progressProof(`${id}.local_orchestration`, []);
      }
    }
  }
  stages.push({
    id: "result", stage: "编排收尾", label: run.terminalAt ? "本轮编排已结束" : "编排进行中", tone: "neutral",
    at: run.terminalAt,
    detail: `${run.overallLabel} · ${progressOrchestrationLabel(leg, events, leg.events.at(-1)?.detail || leg.detail || "等待执行", orders)}`,
    proof: progressProof("execution.lifecycle", executionEvents.filter(event => event.kind.startsWith("execution_")
      && Boolean(event.executionId) && executionIds.has(event.executionId)
      && attempt.some(fact => fact.ownerUserId === event.ownerUserId && fact.linkId === event.linkId))),
  });
  return stages;
}
