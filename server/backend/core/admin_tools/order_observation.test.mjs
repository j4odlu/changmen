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
});
