import { normalizeObservationEvent, OBSERVATION_TITLE } from "@changmen/shared/order_observation";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveObservationBatch, summarizeOrderObservations } from "./order_observation.js";

const mocks = vi.hoisted(() => ({ insert: vi.fn() }));
vi.mock("@changmen/db", () => ({ insertOrderObservations: mocks.insert }));
const base = { version: 1, eventId: "event-001", ownerUserId: "u1", linkId: 123, attemptId: "a1", occurredAt: 1000, sequence: 1, kind: "precheck_started" };
const query = events => ({ status: "available", events, truncated: false });

describe("旁路观察协议与证据回放", () => {
  beforeEach(() => { mocks.insert.mockReset(); });
  it("rejects another user and strips credentials and request payloads", async () => {
    expect(normalizeObservationEvent(base, "u2")).toBeNull();
    const sanitized = normalizeObservationEvent({ ...base, token: "secret", request: { key: "secret" }, config: {} }, "u1");
    expect(sanitized).not.toHaveProperty("token");
    expect(sanitized).not.toHaveProperty("request");
    const result = await saveObservationBatch({ title: OBSERVATION_TITLE, data: JSON.stringify({ ownerUserId: "u1", events: [base] }) }, "u2");
    expect(result.ok).toBe(false);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("leaves ordinary logs alone and only acknowledges committed event IDs", async () => {
    expect(await saveObservationBatch({ title: "下注" }, "u1")).toBeNull();
    mocks.insert.mockResolvedValue([base.eventId]);
    expect(await saveObservationBatch({ title: OBSERVATION_TITLE, data: JSON.stringify({ ownerUserId: "u1", events: [base] }) }, "u1")).toEqual({ ok: true, info: { accepted: [base.eventId] } });
    mocks.insert.mockImplementation(async () => { throw new Error("missing table"); });
    expect((await saveObservationBatch({ title: OBSERVATION_TITLE, data: JSON.stringify({ ownerUserId: "u1", events: [base] }) }, "u1")).ok).toBe(false);
  });
  it("replays shuffled events by attempt sequence without relying on wall clocks", () => {
    const events = [
      { ...base, eventId: "event-003", sequence: 3, kind: "submission_result", outcome: "accepted", occurredAt: 500 },
      base,
      { ...base, eventId: "event-002", sequence: 2, kind: "submission_started" },
    ];
    const result = summarizeOrderObservations(query(events));
    expect(result.attempts[0].events.map(event => event.sequence)).toEqual([1, 2, 3]);
    expect(result.attempts[0].findings).toContain("接口受理，缺少场馆确认事件");
    expect(result.mode).toBe("shadow");
  });
  it("never treats a policy rejection as an official unfilled confirmation", () => {
    const result = summarizeOrderObservations(query([base, { ...base, eventId: "event-002", sequence: 2, kind: "settlement_observed", outcome: "unfilled", source: "timeout_policy" }]));
    expect(result.attempts[0].findings).toContain("业务按超时策略处理；不是官方拒单回执");
    expect(result.attempts[0].evidence).toBe("client_reported");
  });
  it("flags missing submission results, event gaps and conflicting observations", () => {
    const result = summarizeOrderObservations(query([
      base,
      { ...base, eventId: "event-002", sequence: 2, kind: "submission_started" },
      { ...base, eventId: "event-004", sequence: 4, kind: "settlement_observed", outcome: "filled", source: "adapter" },
      { ...base, eventId: "event-005", sequence: 5, kind: "settlement_observed", outcome: "unfilled", source: "adapter" },
    ]));
    expect(result.attempts[0].findings).toContain("事件序号缺失或冲突");
    expect(result.attempts[0].findings).toContain("已进入提交阶段，提交结果未知");
    expect(result.attempts[0].findings).toContain("场馆观察结果发生冲突，需核查原始事件");
  });
  it("empty and unavailable evidence never proves no submission happened", () => {
    expect(summarizeOrderObservations(query([])).issues).toContain("无旁路事件，不能据此认定未下单");
    expect(summarizeOrderObservations({ status: "unavailable", events: [] }).issues).toContain("旁路事件不可用，保留原诊断");
  });
  it("uses the shared PM rule and keeps current records distinct from historical receipts", () => {
    const submit = { ...base, eventId: "submit-123", kind: "submission_result", provider: "Polymarket", accountId: 7,
      orderId: "pm-original", outcome: "accepted", observedStatus: "delayed", source: "adapter_result" };
    const record = { orderId: "pm-original", provider: "Polymarket", accountId: 7, linkId: 123, status: "None", shares: 10 };
    const result = summarizeOrderObservations(query([submit]), [record]);
    expect(result.attempts[0].confirmation).toMatchObject({ label: "订单已成交 · 未结算", event: undefined,
      proof: { rule: "pm.current_order_record", records: [record] } });
    expect(result.attempts[0].events[0]).toBe(submit);
  });
  it("reports the same explicit whole-execution block for the leg whose precheck passed", () => {
    const check = { ...base, kind: "precheck_result", outcome: "prepared", executionId: "exec-123" };
    const end = { ...base, eventId: "end-123", kind: "execution_finished", attemptId: undefined, executionId: "exec-123", phase: "check", outcome: "blocked" };
    const result = summarizeOrderObservations(query([check, end]));
    expect(result.attempts[0].progress.precheck.label).toBe("预检通过");
    expect(result.attempts[0].progress.submission.label).toBe("未提交");
    expect(result.attempts[0].progress.submission.proof.events.map(event => event.eventId)).toEqual([check.eventId, end.eventId]);
  });

  it("does not treat gap metadata as a duplicate business sequence", () => {
    const result = summarizeOrderObservations(query([
      base,
      { ...base, eventId: "event-001_gap", kind: "transport_gap", reasonCode: "storage_unavailable" },
    ]));
    expect(result.issues).toContain("客户端报告观察事件丢失");
    expect(result.attempts[0].findings).not.toContain("事件序号缺失或冲突");
  });

  it("rejects restored events without a valid owner", () => {
    expect(normalizeObservationEvent({ ...base, ownerUserId: undefined }, undefined)).toBeNull();
    expect(normalizeObservationEvent({ ...base, ownerUserId: "" }, "")).toBeNull();
  });

  it("does not use a policy, pending or orchestration result as venue confirmation", () => {
    for (const [source, outcome] of [["orchestration_result", "filled"], ["timeout_policy", "unfilled"], ["adapter", "timeout"]]) {
      const result = summarizeOrderObservations(query([
        base,
        { ...base, eventId: "event-002", sequence: 2, kind: "submission_result", outcome: "accepted" },
        { ...base, eventId: "event-003", sequence: 3, kind: "settlement_observed", source, outcome },
      ]));
      expect(result.attempts[0].findings).toContain("接口受理，缺少场馆确认事件");
    }
  });
  it("does not merge status decisions when one attempt contains conflicting account identities", () => {
    const result = summarizeOrderObservations(query([
      { ...base, provider: "Polymarket", accountId: 7, kind: "precheck_result", outcome: "prepared", odds: 1.9 },
      { ...base, eventId: "submit-other", sequence: 2, provider: "Polymarket", accountId: 8, kind: "submission_result", outcome: "accepted", observedStatus: "delayed" },
    ]));
    expect(result.attempts[0].progress).toEqual({});
    expect(result.attempts[0].confirmation).toBeUndefined();
    expect(result.attempts[0].findings).toContain("同一尝试的执行、平台、账号或主客身份冲突；不合并判定结果");
    expect(result.attempts[0].events).toHaveLength(2);
  });
  it("keeps conflicting nonzero Links as raw records instead of merging their stage decisions", () => {
    const result = summarizeOrderObservations(query([
      { ...base, provider: "Polymarket", accountId: 7, kind: "precheck_result", outcome: "prepared" },
      { ...base, eventId: "submit-other-link", sequence: 2, linkId: 456, provider: "Polymarket", accountId: 7,
        kind: "submission_result", outcome: "accepted", observedStatus: "delayed" },
    ]));
    expect(result.attempts[0].progress).toEqual({});
    expect(result.attempts[0].confirmation).toBeUndefined();
    expect(result.attempts[0].findings).toContain("同一尝试出现多个非零 Link，关联存在冲突");
    expect(result.attempts[0].events).toHaveLength(2);
  });
  it("allows a zero Link followed by one explicit Link without treating it as conflicting identities", () => {
    const result = summarizeOrderObservations(query([
      { ...base, linkId: 0 },
      { ...base, eventId: "check-explicit-link", sequence: 2, kind: "precheck_result", outcome: "prepared" },
    ]));
    expect(result.attempts[0].progress.precheck.label).toBe("预检通过");
    expect(result.attempts[0].findings).not.toContain("同一尝试出现多个非零 Link，关联存在冲突");
  });
});
