import type { OrderObservationEvent } from "@changmen/shared/order_observation";
import { describe, expect, it } from "vitest";
import { createSSRApp, h } from "vue";
import { renderToString } from "@vue/server-renderer";
import OrderProgressComparison from "@/components/order/OrderProgressComparison.vue";
import type { ActiveBetRun } from "@/types/activeBetRun";
import type { OrderRow } from "@/types/order";
import { observationLegSummary, progressOrchestrationLabel } from "./activeBetRunPresentation";
import { pmOrderConfirmation } from "./pmOrderConfirmation";

function event(kind: OrderObservationEvent["kind"], patch: Partial<OrderObservationEvent> = {}): OrderObservationEvent {
  return { version: 1, ownerUserId: "u", eventId: `event-${kind}`, sequence: 1, linkId: 1, attemptId: "initial", phase: "initial",
    occurredAt: 1000, provider: "Polymarket", accountId: 7, orderId: "pm-current", target: "Away", kind, ...patch };
}
const delayed = event("submission_result", { outcome: "accepted", observedStatus: "delayed" });
const record: OrderRow = { OrderID: "pm-current", Type: "Polymarket", Link: 1, PlayerID: 7, Status: "None", PmShares: 10, PmSide: "buy" };
const observed = (patch: Partial<OrderObservationEvent> = {}) => event("settlement_observed", { source: "adapter", occurredAt: 2000, ...patch });

describe("PM delayed 后按原订单状态展示", () => {
  it("follows the current matching order record from fill to settlement without inventing an update time", () => {
    const events = [delayed, event("bind_result", { outcome: "saved" })];
    expect(pmOrderConfirmation(events, [record])).toMatchObject({ label: "订单已成交 · 未结算", event: undefined });
    expect(observationLegSummary(events, "makeup", false, [{ ...record, Status: "Win" }])).toMatchObject({ label: "已结算 · 赢", tone: "success" });
    expect(pmOrderConfirmation(events, [{ ...record, Status: "Lose" }])?.label).toBe("已结算 · 输");
    expect(progressOrchestrationLabel({ status: "confirmed" }, events, "已成交", [record])).toBe("已成交");
  });
  it.each([{ PmShares: undefined }, { PmShares: 0 }, { PmSide: "sell" as const }, { PlayerID: 8 }, { OrderID: "other" }, { Link: 2 }, { Type: "RAY" }, { Status: "Reject" as const }])("does not promote a placeholder or mismatched order record %j to a fill", patch => {
    expect(pmOrderConfirmation([delayed], [{ ...record, ...patch }])?.label).toBe("订单待确认");
  });
  it.each(["delayed", "live", "unmatched", undefined])("keeps %s or missing state pending even when orchestration claims filled", status => {
    const events = [delayed, event("bind_result", { outcome: "saved" }), observed({ outcome: "filled", observedStatus: status })];
    expect(pmOrderConfirmation(events)?.label).toBe("订单待确认");
    expect(observationLegSummary(events, "confirmed").tone).toBe("pending");
  });
  it.each([
    ["none", "filled", "订单已成交 · 未结算"], ["matched", "filled", "订单已成交"],
    ["win", "filled", "已结算 · 赢"], ["reject", "unfilled", "订单未成交 · 拒单"],
    ["canceled", "unfilled", "订单未成交 · 已取消"],
  ])("shows the matching order state %s", (observedStatus, outcome, label) => {
    const state = pmOrderConfirmation([delayed, observed({ observedStatus, outcome })]);
    expect(state?.label).toBe(label);
    expect(state?.basis).toContain(`订单状态 ${observedStatus}`);
    expect(state?.event?.occurredAt).toBe(2000);
  });
  it("ignores another order, account, provider and successful binding", () => {
    const events = [delayed, observed({ orderId: "pm-old", outcome: "filled", observedStatus: "none" }),
      observed({ accountId: 8, outcome: "filled", observedStatus: "none" }),
      observed({ provider: "RAY", outcome: "filled", observedStatus: "none" }), event("bind_result", { orderId: "pm-old", outcome: "saved" })];
    expect(pmOrderConfirmation(events)?.label).toBe("订单待确认");
    expect(observationLegSummary(events, "confirmed")).toMatchObject({ label: "订单待确认", orderId: "pm-current", bound: false });
    expect(pmOrderConfirmation([{ ...delayed, orderId: undefined }, observed({ outcome: "filled", observedStatus: "none" })])?.label).toBe("订单待确认");
  });
  it("keeps timeout policy separate and never lets it replace a confirmed fill", () => {
    const policy = observed({ source: "timeout_policy", outcome: "unfilled", observedStatus: "delayed" });
    expect(pmOrderConfirmation([delayed, policy])?.label).toBe("超时策略处理");
    expect(pmOrderConfirmation([delayed, observed({ outcome: "filled", observedStatus: "none" }), policy])?.label).toBe("订单已成交 · 未结算");
    expect(pmOrderConfirmation([delayed, observed({ source: "orchestration_result", outcome: "filled", observedStatus: "matched" })])?.label).toBe("订单待确认");
  });
  it("updates settlement state while retaining contradictory terminal receipts", () => {
    const fill = observed({ outcome: "filled", observedStatus: "none" });
    expect(pmOrderConfirmation([delayed, fill, observed({ outcome: "filled", observedStatus: "win" })])?.label).toBe("已结算 · 赢");
    expect(pmOrderConfirmation([delayed, fill, observed({ outcome: "filled", observedStatus: "win" })], [record])?.label).toBe("已结算 · 赢");
    expect(pmOrderConfirmation([delayed, fill, observed({ outcome: "unfilled", observedStatus: "reject" })])?.label).toBe("订单确认记录冲突");
    expect(pmOrderConfirmation([delayed, observed({ outcome: "unfilled", observedStatus: "reject" })], [record])?.label).toBe("订单确认记录冲突");
  });
  it("renders order status after delayed without changing the original submission or borrowing a makeup order", async () => {
    const run: ActiveBetRun = { betId: 1, matchId: 1, matchTitle: "A vs B", betName: "获胜", phase: "makeup", overallLabel: "补单中", startedAt: 1000, updatedAt: 2000,
      legs: [{ side: "B", target: "Away", platform: "Polymarket", status: "makeup", events: [] }], events: [] };
    const events = [delayed, observed({ outcome: "filled", observedStatus: "none" }),
      event("submission_result", { attemptId: "makeup", phase: "makeup", orderId: "pm-makeup", outcome: "accepted", observedStatus: "delayed" }),
      observed({ attemptId: "makeup", phase: "makeup", orderId: "pm-current", outcome: "filled", observedStatus: "none" })];
    const html = await renderToString(createSSRApp({ render: () => h(OrderProgressComparison, { run, facts: new Map<"A" | "B", OrderObservationEvent[]>([["B", events]]) }) }));
    const rows = [...html.matchAll(/<tr data-stage="confirmation">([\s\S]*?)<\/tr>/g)].map(match => match[1]!);
    expect(rows[0]).toContain("订单已成交 · 未结算");
    expect(rows[0]).toContain("订单状态 none");
    expect(rows[1]).toContain("订单待确认");
    expect(html).toContain("delayed · 已受理待检测");
    expect(html).not.toContain("观察到成交");
    const updated = await renderToString(createSSRApp({ render: () => h(OrderProgressComparison, { run, facts: new Map<"A" | "B", OrderObservationEvent[]>([["B", [delayed]]]), orders: [{ ...record, Status: "Win" }] }) }));
    expect(updated).toContain("已结算 · 赢");
    expect(updated).toContain("当前订单状态 Win");
  });
});
