import type { OrderObservationEvent } from "@changmen/shared/order_observation";
import type { OrderRow } from "@/types/order";
import { describe, expect, it } from "vitest";
import { observationLegSummary } from "./activeBetRunPresentation";
import { boundRayOrderEvidence } from "./boundRayOrderEvidence";

const settlement: OrderObservationEvent = { version: 1, ownerUserId: "u1", eventId: "s", attemptId: "a", sequence: 1,
  linkId: 1791393169434, accountId: 46, provider: "RAY", occurredAt: 1791393203084,
  kind: "settlement_observed", outcome: "unfilled", source: "orchestration_result" };
const binding: OrderObservationEvent = { ...settlement, eventId: "b", sequence: 2, kind: "bind_result", outcome: "saved", orderId: "406855f4d96e6acdb1ee" };
const order: OrderRow = { OrderID: binding.orderId, Type: "RAY", PlayerID: 46, Link: settlement.linkId, Status: "Reject" };

describe("旧 RAY 检测记录的已绑定订单证据", () => {
  it("shows the actual rejection without mutating the historic observation", () => {
    const facts = [settlement, binding];
    const evidence = boundRayOrderEvidence(facts, [order]);
    expect(observationLegSummary(facts, "rejected", false, [order])).toMatchObject({ label: "检测到拒单", basis: "已绑定订单当前状态为拒单" });
    expect(evidence?.proof.events[0]).toMatchObject({ eventId: "s", source: "orchestration_result", occurredAt: settlement.occurredAt });
    expect(evidence?.proof.records[0]).toMatchObject({ orderId: order.OrderID, status: "Reject" });
    expect(facts[0]).toBe(settlement);
    expect(settlement.source).toBe("orchestration_result");
    expect(settlement.orderId).toBeUndefined();
  });
  it.each([{ PlayerID: 99 }, { Link: 99 }, { Type: "OB" }, { OrderID: "another" }, { Status: "None" as const }])("does not attach mismatched order %j", patch => {
    expect(boundRayOrderEvidence([settlement, binding], [{ ...order, ...patch }])).toBeUndefined();
  });
  it.each([{ ownerUserId: "u2" }, { attemptId: "other" }, { accountId: 99 }, { linkId: 99 }, { outcome: "failed" }])("requires a successful same-attempt binding %j", patch => {
    expect(boundRayOrderEvidence([settlement, { ...binding, ...patch }], [order])).toBeUndefined();
  });
  it("retains uncertain and policy results or ambiguous bindings", () => {
    expect(boundRayOrderEvidence([settlement], [order])).toBeUndefined();
    expect(boundRayOrderEvidence([settlement, binding, { ...binding, orderId: "second" }], [order])).toBeUndefined();
    const policy = { ...settlement, source: "timeout_policy" };
    expect(boundRayOrderEvidence([policy, binding], [order])).toBeUndefined();
    const mismatched = { ...settlement, orderId: "different" };
    expect(boundRayOrderEvidence([mismatched, binding], [order])).toBeUndefined();
    expect(boundRayOrderEvidence([settlement, { ...binding, source: "ray_bind_api_ack" }], [order])).toBeUndefined();
  });
  it("retains contradictory historical settlement evidence beside the current record", () => {
    const terminal = { ...settlement, eventId: "terminal", source: "adapter", orderId: binding.orderId, outcome: "filled", observedStatus: "win" };
    const evidence = boundRayOrderEvidence([settlement, binding, terminal], [order]);
    expect(evidence?.label).toBe("确认记录冲突");
    expect(evidence?.proof.events.map(event => event.eventId)).toEqual(["s", "b", "terminal"]);
  });
});
