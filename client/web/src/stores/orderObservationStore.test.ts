import type { OrderObservationEvent } from "@changmen/shared/order_observation";
import { observationEventLabel, orderObservationTargets, orderObservationTimeline } from "@changmen/shared/order_observation_view";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrderObservationOutbox } from "@/services/orderObservationOutbox";
import { useActiveBetRunStore } from "./activeBetRunStore";
import { useOrderObservationStore } from "./orderObservationStore";

vi.mock("@/stores/accountStore", () => ({ useAccountStore: () => ({ findAccount: () => undefined }) }));
function event(eventId: string, patch: Partial<OrderObservationEvent> = {}): OrderObservationEvent {
  return {
    version: 1,
    eventId,
    ownerUserId: "u1",
    linkId: 123,
    attemptId: "attempt-1",
    occurredAt: 1000,
    sequence: 1,
    kind: "submission_started",
    target: "Home",
    ...patch,
  };
}

describe("实时进度与诊断共用执行事实", () => {
  beforeEach(() => { setActivePinia(createPinia()); });

  it("shows the concrete precheck cause and duration instead of calling it a summary category", () => {
    const label = observationEventLabel(event("event-price", { kind: "precheck_result", outcome: "blocked", durationMs: 470,
      safeSummary: "当前卖价高于检测限价，已阻止提交（卖价 0.46，限价 0.4444）" }));
    expect(label).toBe("预检结果 · 被拦截 · 原因：当前卖价高于检测限价，已阻止提交（卖价 0.46，限价 0.4444） · 470ms");
    expect(label).not.toContain("摘要分类");
  });
  it.each([
    ["no_account", "没有可用的下单账号"],
    ["unsupported_provider", "不支持下单预检"],
    ["precheck_error", "未记录具体原因"],
  ])("explains legacy precheck reason code %s without inventing missing evidence", (reasonCode, expected) => {
    expect(observationEventLabel(event("event-legacy", { kind: "precheck_result", outcome: "blocked", reasonCode }))).toContain(expected);
  });

  it("uses the same event IDs, payload and labels locally and after upload acknowledgement", async () => {
    const store = useOrderObservationStore();
    const received: OrderObservationEvent[] = [];
    const outbox = new OrderObservationOutbox({ owner: () => "u1", read: () => null, write: () => {}, onEvent: row => store.record(row), send: async (_owner, rows) => { received.push(...JSON.parse(JSON.stringify(rows))); return rows.map(row => row.eventId); } });
    outbox.enqueue(event("event-001"));
    outbox.enqueue(event("event-002", { sequence: 2, kind: "submission_result", outcome: "accepted" }));
    expect(received).toHaveLength(0);
    expect(store.forLink("u1", 123)).toHaveLength(2);
    await outbox.flush();
    expect(store.forLink("u1", 123)).toEqual(orderObservationTimeline(received));
    expect(store.forLink("u1", 123).map(observationEventLabel)).toEqual(orderObservationTimeline(received).map(observationEventLabel));
  });

  it("isolates users and attempts and never treats zero Link as a group", () => {
    const store = useOrderObservationStore();
    store.record(event("event-001"));
    store.record(event("event-002", { linkId: 0, sequence: 2 }));
    store.record(event("event-003", { linkId: 0, attemptId: "other-attempt" }));
    store.record(event("event-004", { ownerUserId: "u2" }));
    store.record(event("event-005", { linkId: 456, attemptId: "next-attempt" }));
    expect(store.forLink("u1", 123).map(row => row.eventId)).toEqual(["event-001", "event-002"]);
    expect(store.forLink("u1", 0)).toEqual([]);
    expect(store.forLink("u2", 123).map(row => row.eventId)).toEqual(["event-004"]);
  });

  it("does not mutate business leg states, phase, countdown or removal rules", () => {
    const business = useActiveBetRunStore();
    business.upsertRun(10, { matchId: 1, matchTitle: "match", betName: "bet", linkId: 123, phase: "makeup", legs: [{ side: "A", platform: "OB", target: "Home", status: "makeup", events: [] }] });
    const before = JSON.stringify(business.runs.get(10));
    useOrderObservationStore().record(event("event-001", { kind: "settlement_observed", outcome: "filled", source: "adapter" }));
    expect(JSON.stringify(business.runs.get(10))).toBe(before);
    expect(business.runs.get(10)?.legs[0]?.status).toBe("makeup");
  });

  it("sorts by sequence within an attempt and keeps policy and rule results distinct", () => {
    const rows = [event("event-002", { occurredAt: 500, sequence: 2 }), event("event-001")];
    const snapshot = JSON.stringify(rows);
    expect(orderObservationTimeline(rows).map(row => row.sequence)).toEqual([1, 2]);
    expect(JSON.stringify(rows)).toBe(snapshot);
    expect(observationEventLabel(event("event-003", { kind: "settlement_observed", outcome: "unfilled", source: "timeout_policy" }))).toContain("非官方拒单回执");
    expect(observationEventLabel(event("event-004", { kind: "settlement_observed", outcome: "filled", source: "orchestration_result" }))).toContain("缺少精确订单确认");
  });

  it("deduplicates event IDs and bounds the local view", () => {
    const store = useOrderObservationStore();
    store.record(event("event-001"));
    store.record(event("event-001"));
    expect(store.events).toHaveLength(1);
    for (let i = 0; i < 520; i++) store.record(event(`event-${i + 1000}`));
    expect(store.events).toHaveLength(512);
  });

  it("interleaves queue lifecycle and its child attempt instead of showing removal before submission", () => {
    const rows = [
      event("event-001", { attemptId: undefined, queueId: "q1", kind: "queue_created", occurredAt: 1000 }),
      event("event-003", { attemptId: undefined, queueId: "q1", kind: "queue_removed", occurredAt: 2000, sequence: 2 }),
      event("event-002", { queueId: "q1", occurredAt: 1500 }),
    ];
    expect(orderObservationTimeline(rows).map(row => row.kind)).toEqual(["queue_created", "submission_started", "queue_removed"]);
  });

  it("attributes target-less binding acknowledgements only to an unambiguous original attempt", () => {
    const started = event("event-001");
    const bound = event("event-002", { kind: "bind_result", target: undefined, sequence: 2 });
    expect(orderObservationTargets([started, bound]).get(bound)).toBe("Home");
    const conflicting = event("event-003", { target: "Away", sequence: 3 });
    expect(orderObservationTargets([started, bound, conflicting]).get(bound)).toBeUndefined();
    const foreign = event("event-004", { ownerUserId: "u2", target: "Away" });
    expect(orderObservationTargets([started, bound, foreign]).get(bound)).toBe("Home");
    const otherAttempt = event("event-005", { attemptId: "other", target: "Away" });
    expect(orderObservationTargets([bound, otherAttempt]).get(bound)).toBeUndefined();
  });

  it("signals local history truncation only for owners whose records were removed", () => {
    const store = useOrderObservationStore();
    store.record(event("event-u2", { ownerUserId: "u2" }));
    for (let i = 0; i < 512; i++) store.record(event(`event-${1000 + i}`));
    expect(store.truncatedOwners).toEqual(["u2"]);
    store.record(event("event-new"));
    expect(store.truncatedOwners).toEqual(["u2", "u1"]);
  });

  it("does not translate unknown status codes through Object prototype properties", () => {
    expect(observationEventLabel(event("event-001", { outcome: "constructor" }))).toBe("开始场馆下注处理（尚未确认请求发出） · constructor");
    expect(observationEventLabel(event("event-002", { source: "orchestration_result", outcome: "toString" }))).toContain("编排判定：toString");
  });
});
