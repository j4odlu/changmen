import type { OrderObservationEvent } from "@changmen/shared/order_observation";
import { delayedPmConfirmation, progressProof } from "@changmen/shared/order_progress_evidence";
import { describe, expect, it } from "vitest";
import { activeBetLegStages } from "./activeBetRunStages";
import type { ActiveBetRun } from "@/types/activeBetRun";

const submit: OrderObservationEvent = { version: 1, ownerUserId: "u1", eventId: "submit-123", occurredAt: 1000, sequence: 1,
  kind: "submission_result", provider: "Polymarket", accountId: 7, orderId: "pm-original", executionId: "exec-123", attemptId: "a1",
  linkId: 1, outcome: "accepted", observedStatus: "delayed", source: "adapter_result" };
const receipt: OrderObservationEvent = { ...submit, eventId: "receipt-123", sequence: 2, occurredAt: 2000,
  kind: "settlement_observed", outcome: "filled", observedStatus: "none", source: "adapter" };

describe("只读下单判定依据", () => {
  it("copies immutable whitelisted evidence without leaking extra payloads", () => {
    const event = { ...submit, request: { token: "sensitive" }, token: "sensitive" };
    const record = { orderId: "o1", provider: "Polymarket", status: "None", shares: 10, raw: { token: "sensitive" } };
    const proof = progressProof("test", [event, event], [record]);
    event.observedStatus = "matched";
    record.status = "Reject";
    expect(proof.events).toHaveLength(1);
    expect(proof.events[0]?.observedStatus).toBe("delayed");
    expect(proof.records[0]?.status).toBe("None");
    expect(JSON.stringify(proof)).not.toContain("sensitive");
    expect(Object.isFrozen(proof.events[0])).toBe(true);
  });
  it.each([{ ownerUserId: "u2" }, { attemptId: "a2" }, { executionId: "exec-other" }, { accountId: 8 }, { orderId: "pm-other" }])("does not borrow another identity's receipt %j", patch => {
    const result = delayedPmConfirmation([submit, { ...receipt, ...patch }]);
    expect(result?.label).toBe("订单待确认");
    expect(result?.proof.events.map(event => event.eventId)).toEqual([submit.eventId]);
  });
  it("preserves both contradictory receipts and their distinct times", () => {
    const rejection = { ...receipt, eventId: "reject-123", sequence: 3, occurredAt: 3000, outcome: "unfilled", observedStatus: "reject" };
    const result = delayedPmConfirmation(Object.freeze([Object.freeze(submit), Object.freeze(receipt), Object.freeze(rejection)]));
    expect(result?.label).toBe("订单确认记录冲突");
    expect(result?.proof.events.map(event => event.eventId)).toEqual([submit.eventId, receipt.eventId, rejection.eventId]);
    expect(result?.proof.events.map(event => event.occurredAt)).toEqual([1000, 2000, 3000]);
  });
  it("attributes a whole-run block to the root event rather than missing submission logs", () => {
    const check: OrderObservationEvent = { ...submit, eventId: "check-123", kind: "precheck_result", provider: "RAY", outcome: "prepared" };
    const end: OrderObservationEvent = { ...check, eventId: "end-123", kind: "execution_finished", attemptId: undefined, phase: "check", outcome: "blocked" };
    const leg = { side: "A" as const, target: "Home" as const, platform: "RAY", status: "failed" as const, events: [] };
    const run: ActiveBetRun = { betId: 1, matchId: 1, startedAt: 1000, updatedAt: 2000, terminalAt: 2000, matchTitle: "A vs B", betName: "获胜",
      phase: "syncing", overallLabel: "预检失败", legs: [leg], events: [] };
    const stages = activeBetLegStages(run, leg, [check], [], [end]);
    expect(stages.find(stage => stage.id === "submission")?.proof?.events.map(event => event.eventId)).toEqual([check.eventId, end.eventId]);
    expect(activeBetLegStages(run, leg, [check], [], [{ ...end, ownerUserId: "u2" }]).find(stage => stage.id === "submission")?.label).toBe("提交记录缺失");
    expect(activeBetLegStages(run, leg, [check], [], [{ ...end, executionId: undefined }]).find(stage => stage.id === "result")?.proof?.events).toEqual([]);
  });
  it("does not put a historical event timestamp on a current RAY rejection record", () => {
    const settlement = { ...receipt, provider: "RAY", outcome: "unfilled", source: "orchestration_result", orderId: undefined };
    const binding = { ...settlement, eventId: "bind-123", kind: "bind_result" as const, source: "bind_api_ack", outcome: "saved", orderId: "ray-original" };
    const leg = { side: "A" as const, target: "Home" as const, platform: "RAY", status: "rejected" as const, events: [] };
    const run: ActiveBetRun = { betId: 1, matchId: 1, startedAt: 1000, updatedAt: 2000, terminalAt: 2000, matchTitle: "A vs B", betName: "获胜",
      phase: "syncing", overallLabel: "拒单", legs: [leg], events: [] };
    const row = activeBetLegStages(run, leg, [settlement, binding], [{ OrderID: "ray-original", Type: "RAY", PlayerID: 7, Link: 1, Status: "Reject" }])
      .find(stage => stage.id === "confirmation");
    expect(row).toMatchObject({ label: "检测到拒单", at: undefined, durationMs: undefined });
    expect(row?.proof?.events[0]?.source).toBe("orchestration_result");
    expect(settlement.source).toBe("orchestration_result");
  });
});
