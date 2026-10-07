import type { OrderObservationEvent } from "@changmen/shared/order_observation";
import type { OrderRow } from "@/types/order";
import { describe, expect, it } from "vitest";
import { observationLegSummary } from "./activeBetRunPresentation";
import { withBoundRayOrderEvidence } from "./boundRayOrderEvidence";

const settlement: OrderObservationEvent = { version: 1, ownerUserId: "u1", eventId: "s", attemptId: "a", sequence: 1,
  linkId: 1791393169434, accountId: 46, provider: "RAY", occurredAt: 1791393203084,
  kind: "settlement_observed", outcome: "unfilled", source: "orchestration_result" };
const binding: OrderObservationEvent = { ...settlement, eventId: "b", sequence: 2, kind: "bind_result", outcome: "saved", orderId: "406855f4d96e6acdb1ee" };
const order: OrderRow = { OrderID: binding.orderId, Type: "RAY", PlayerID: 46, Link: settlement.linkId, Status: "Reject" };

describe("旧 RAY 检测记录的已绑定订单证据", () => {
  it("shows the actual rejection without mutating the historic observation", () => {
    const facts = withBoundRayOrderEvidence([settlement, binding], [order]);
    expect(observationLegSummary(facts, "rejected")).toMatchObject({ label: "检测到拒单", basis: "已绑定订单当前状态为拒单" });
    expect(settlement.source).toBe("orchestration_result");
    expect(settlement.orderId).toBeUndefined();
  });
  it.each([{ PlayerID: 99 }, { Link: 99 }, { Type: "OB" }, { OrderID: "another" }, { Status: "None" as const }])("does not attach mismatched order %j", patch => {
    expect(withBoundRayOrderEvidence([settlement, binding], [{ ...order, ...patch }])[0]).toBe(settlement);
  });
  it.each([{ ownerUserId: "u2" }, { attemptId: "other" }, { accountId: 99 }, { linkId: 99 }, { outcome: "failed" }])("requires a successful same-attempt binding %j", patch => {
    expect(withBoundRayOrderEvidence([settlement, { ...binding, ...patch }], [order])[0]).toBe(settlement);
  });
  it("retains uncertain and policy results or ambiguous bindings", () => {
    expect(withBoundRayOrderEvidence([settlement], [order])[0]).toBe(settlement);
    expect(withBoundRayOrderEvidence([settlement, binding, { ...binding, orderId: "second" }], [order])[0]).toBe(settlement);
    const policy = { ...settlement, source: "timeout_policy" };
    expect(withBoundRayOrderEvidence([policy, binding], [order])[0]).toBe(policy);
    const mismatched = { ...settlement, orderId: "different" };
    expect(withBoundRayOrderEvidence([mismatched, binding], [order])[0]).toBe(mismatched);
    expect(withBoundRayOrderEvidence([settlement, { ...binding, source: "ray_bind_api_ack" }], [order])[0]).toBe(settlement);
  });
});
