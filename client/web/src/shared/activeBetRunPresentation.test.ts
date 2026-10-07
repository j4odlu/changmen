import type { OrderObservationEvent } from "@changmen/shared/order_observation";
import { describe, expect, it } from "vitest";
import { activeBetLegRole, activeBetRunMode, activeBetRunModeLabel, observationLegGroups, observationLegSummary, progressEvidenceWarnings, progressOrchestrationLabel } from "./activeBetRunPresentation";

function event(kind: OrderObservationEvent["kind"], patch: Partial<OrderObservationEvent> = {}): OrderObservationEvent {
  return { version: 1, eventId: "event-123", ownerUserId: "u1", sequence: 1, occurredAt: 1000, linkId: 123, attemptId: "attempt-1", kind, ...patch };
}
describe("实时进度只读摘要", () => {
  it("keeps the successful precheck visible after submission, confirmation, binding and later decisions", () => {
    const events = [
      event("precheck_started"),
      event("precheck_result", { sequence: 2, outcome: "prepared", occurredAt: 1200, durationMs: 200 }),
      event("submission_started", { sequence: 3 }),
      event("submission_result", { sequence: 4, outcome: "accepted" }),
      event("settlement_observed", { sequence: 5, outcome: "filled", source: "adapter" }),
      event("bind_result", { sequence: 6, outcome: "saved" }),
      event("decision", { sequence: 7, outcome: "registered" }),
      event("decision", { sequence: 8, outcome: "bound" }),
      event("decision", { sequence: 9, outcome: "expired" }),
    ];
    expect(events.slice(-6).some(row => row.kind === "precheck_result")).toBe(false);
    const summary = observationLegSummary(events, "confirmed");
    expect(summary.label).toBe("观察到成交");
    expect(summary.precheck).toMatchObject({ label: "预检通过", tone: "success", at: 1200, durationMs: 200 });
  });
  it("preserves failed prechecks and their reason independently of later progress", () => {
    const summary = observationLegSummary([
      event("precheck_result", { outcome: "blocked", safeSummary: "盘口已关闭" }),
      event("bind_result", { sequence: 2, outcome: "saved" }),
    ], "failed");
    expect(summary.precheck.label).toBe("预检失败");
    expect(summary.precheck.tone).toBe("danger");
    expect(summary.precheck.basis).toContain("盘口已关闭");
  });
  it("does not reuse an earlier passed precheck for a retry or infer it from acceptance", () => {
    const passed = event("precheck_result", { outcome: "prepared" });
    const retry = event("submission_result", { attemptId: "attempt-2", outcome: "accepted" });
    const delayed = event("bind_result", { sequence: 2, outcome: "saved" });
    expect(observationLegSummary([passed, retry, delayed], "confirmed").precheck.label).toBe("预检结果未记录");
    expect(observationLegSummary([], "confirmed").precheck.label).toBe("预检结果未记录");
  });
  it("distinguishes an ongoing precheck from a result with an unknown outcome", () => {
    expect(observationLegSummary([event("precheck_started")], "pending").precheck).toMatchObject({ label: "正在预检", tone: "pending" });
    expect(observationLegSummary([event("precheck_result")], "pending").precheck).toMatchObject({ label: "预检结果未明确", tone: "warning" });
  });
  it("shows the venue failure reason and business code without claiming confirmed rejection", () => {
    const summary = observationLegSummary([event("submission_result", { provider: "RAY", outcome: "adapter_failed", responseCode: "500", safeSummary: "RAY 场馆返回：投注操作失败，请稍后重试" })], "failed");
    expect(summary.label).toBe("提交返回失败");
    expect(summary.failureReason).toBe("RAY 场馆返回：投注操作失败，请稍后重试（场馆业务码 500）");
    expect(summary.basis).toContain("尚不证明未成交");
  });
  it("explains the missing description on historical generic RAY failures", () => {
    const summary = observationLegSummary([event("submission_result", { provider: "RAY", outcome: "adapter_failed", responseCode: "500", safeSummary: "执行失败，未记录可识别的具体原因" })], "failed");
    expect(summary.failureReason).toBe("该次记录未保留场馆错误说明（场馆业务码 500）");
  });
  it("does not carry a previous failure into an accepted retry", () => {
    const summary = observationLegSummary([
      event("submission_result", { provider: "RAY", outcome: "adapter_failed", safeSummary: "旧错误" }),
      event("submission_result", { attemptId: "attempt-2", outcome: "accepted" }),
    ], "confirmed");
    expect(summary.failureReason).toBeUndefined();
  });
  it("identifies execution mode without guessing from remaining legs or settlement status", () => {
    expect(activeBetRunMode({ mode: "arb", linkId: -1_000 })).toBe("arb");
    expect(activeBetRunModeLabel({ mode: "arb" })).toBe("双边套利");
    expect(activeBetRunModeLabel({ linkId: -1_800_000_000_000 })).toBe("9999 单边下单");
    expect(activeBetRunModeLabel({ mode: "valueBet" })).toBe("正EV 单腿下单");
    expect(activeBetRunModeLabel({})).toBe("模式未记录");
    const leg = { side: "A", platform: "Polymarket", target: "Home", status: "pending", events: [] } as const;
    expect(activeBetLegRole({ ...leg, events: [] })).toBe("下单腿");
    expect(activeBetLegRole({ ...leg, events: [], precheckOnly: true })).toBe("仅预检 · 不下单");
    expect(activeBetLegRole({ ...leg, events: [], status: "skipped" })).toBe("不参与");
  });
  it("does not turn adapter acceptance or successful binding into venue confirmation", () => {
    const summary = observationLegSummary([event("submission_result", { outcome: "accepted" }), event("bind_result", { outcome: "saved", sequence: 2 })], "confirmed");
    expect(summary.label).toBe("已受理 · 待确认");
    expect(summary.bound).toBe(true);
    expect(summary.tone).toBe("pending");
  });
  it("distinguishes timeout policy and orchestration from venue evidence", () => {
    expect(observationLegSummary([event("settlement_observed", { outcome: "unfilled", source: "timeout_policy" })], "rejected").label).toBe("超时策略处理");
    expect(observationLegSummary([event("settlement_observed", { outcome: "filled", source: "orchestration_result" })], "confirmed").label).toBe("编排判定成交 · 缺少场馆确认记录");
    expect(observationLegSummary([event("settlement_observed", { outcome: "filled", source: "adapter" })], "confirmed").label).toBe("观察到成交");
  });
  it("does not display a precheck-only or unverified orchestration result as a confirmed fill", () => {
    const events = [event("precheck_result", { outcome: "prepared" })];
    const leg = { side: "A", platform: "Polymarket", target: "Home", status: "confirmed", detail: "已成交", events: [] } as const;
    expect(progressOrchestrationLabel(leg, events, "已成交")).toBe("编排判定成交 · 缺少场馆确认记录");
    expect(progressOrchestrationLabel({ ...leg, precheckOnly: true }, events, "已成交")).toBe("9999 仅预检 · 不下单");
    expect(observationLegSummary(events, "confirmed", true).label).toBe("9999 预检通过 · 不下单");
    expect(observationLegSummary([], "confirmed", true).label).toBe("9999 仅预检 · 不下单");
    expect(progressOrchestrationLabel(leg, [event("settlement_observed", { outcome: "filled", source: "adapter" })], "已成交")).toBe("已成交");
  });
  it("warns on conflicting venue confirmations", () => {
    const events = [event("settlement_observed", { outcome: "filled", source: "adapter" }), event("settlement_observed", { outcome: "unfilled", source: "adapter", sequence: 2 })];
    expect(observationLegSummary(events, "confirmed").label).toBe("确认记录冲突");
  });
  it("does not claim missing evidence when a later RAY monitor actually observed rejection", () => {
    const events = [event("settlement_observed", { provider: "RAY", orderId: "r1", outcome: "filled", observedStatus: "none", source: "adapter" }),
      event("settlement_observed", { provider: "RAY", orderId: "r1", outcome: "unfilled", observedStatus: "reject", source: "ray_monitor" })];
    expect(progressOrchestrationLabel({ status: "confirmed" }, events, "已成交")).toBe("编排曾判定成交 · 后续检测到拒单");
  });
  it("keeps summaries and bindings separate across retry attempts", () => {
    const events = [event("bind_result", { outcome: "saved", orderId: "old" }), event("submission_result", { attemptId: "attempt-2", outcome: "unknown", retryRound: 1, orderId: "new", amount: 12.25, currency: "USDC" })];
    const summary = observationLegSummary(events, "failed");
    expect(summary.label).toBe("提交结果未知");
    expect(summary.orderId).toBe("new");
    expect(summary.bound).toBe(false);
    expect(summary.retries).toBe(1);
    expect(summary.amount).toBe("12.25 USDC");
    expect(observationLegSummary([event("precheck_result", { amount: 5 })], "pending").amount).toBe("5 （币种未记录）");
  });
  it("does not claim no submission when its result is missing", () => {
    expect(observationLegSummary([event("submission_started"), event("precheck_result", { outcome: "blocked", sequence: 2 })], "failed").label).toBe("结果待核查");
  });
  it("does not let a delayed binding of the original attempt overwrite a newer retry summary", () => {
    const events = [event("submission_result", { outcome: "adapter_failed" }), event("submission_result", { attemptId: "attempt-2", outcome: "unknown", retryRound: 1 }), event("bind_result", { sequence: 2, outcome: "saved", orderId: "old" })];
    const summary = observationLegSummary(events, "failed");
    expect(summary.attemptId).toBe("attempt-2");
    expect(summary.label).toBe("提交结果未知");
    expect(summary.bound).toBe(false);
    expect(summary.orderId).toBeUndefined();
  });
  it("marks gaps while excluding transport metadata from sequence checks", () => {
    const events = [event("precheck_started"), event("transport_gap", { sequence: 1 }), event("precheck_result", { sequence: 3 })];
    expect(progressEvidenceWarnings(events)).toEqual(["执行记录存在上传或缓存缺口", "部分执行事件缺失"]);
    expect(progressEvidenceWarnings([event("precheck_started"), event("precheck_result", { sequence: 1 })])).toContain("执行记录序号冲突");
  });
});

describe("执行时间线主客方向", () => {
  const legs = [{ side: "A", target: "Away" }, { side: "B", target: "Home" }] as const;
  it("uses targets rather than leg order or provider and retains whole-order events", () => {
    const away = event("submission_started", { target: "Away", provider: "OB" });
    const home = event("submission_started", { target: "Home", attemptId: "home", provider: "OB" });
    const receipt = event("bind_result", { attemptId: "home", outcome: "saved" });
    const root = event("execution_started", { attemptId: undefined });
    const groups = observationLegGroups([away, home, receipt, root], legs);
    expect(groups.groups.get("A")).toEqual([away]);
    expect(groups.groups.get("B")).toEqual([home, receipt]);
    expect(groups.unassigned).toEqual([root]);
  });
  it("keeps ambiguous and unrelated receipts outside both direction timelines", () => {
    const home = event("submission_started", { target: "Home" });
    const away = event("submission_started", { target: "Away" });
    const ambiguous = event("bind_result");
    const unrelated = event("bind_result", { attemptId: "unknown" });
    const groups = observationLegGroups([home, away, ambiguous, unrelated], legs);
    expect(groups.groups.get("A")).toEqual([away]);
    expect(groups.groups.get("B")).toEqual([home]);
    expect(groups.unassigned).toEqual([ambiguous, unrelated]);
  });
});
