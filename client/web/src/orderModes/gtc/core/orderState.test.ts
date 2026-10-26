import type { GtcFill, GtcOrderState } from "@changmen/shared/pm_gtc_order";
import { canCancelGtcOrder, mergeGtcOrderFacts } from "@changmen/shared/pm_gtc_order";
import { expect, it } from "vitest";

function order(): GtcOrderState {
  return { plan: { tokenId: "token", conditionId: "condition", shares: "10", targetShares: "10", price: "0.5", maxPrincipal: "5",
    allInBudget: "5", protocol: 2, negRisk: false, route: "direct", orderHash: "hash" },
  submit: "accepted", orderId: "hash", pmAuthorized: true, cancel: null, fills: {}, order: null,
  matched: "0", principal: "0", fee: "0", open: null, terminal: false, complete: false, observedAt: 0, error: "" };
}
const fill: GtcFill = { key: "trade:maker", tradeId: "trade", bucket: "maker", role: "MAKER", shares: "3", price: "0.5", fee: "0", status: "CONFIRMED", updatedAt: 1 };
it("reconciles a partial maker fill without business, opposite leg or match data", () => {
  const original = order();
  const next = mergeGtcOrderFacts(original, { order: { id: "hash", original: "10", matched: "3", status: "LIVE", tradeIds: ["trade"] }, fills: [fill], complete: true, observedAt: 1 });
  expect(next).toMatchObject({ matched: "3", principal: "1.5", fee: "0", open: "7", complete: true, terminal: false });
  expect(canCancelGtcOrder(next)).toBe(true); expect(original.matched).toBe("0");
  expect(next).not.toHaveProperty("other"); expect(next).not.toHaveProperty("groupComplete");
});
it("retains partial fills after cancellation and never invents a full fill", () => {
  const next = mergeGtcOrderFacts(order(), { order: { id: "hash", original: "10", matched: "3", status: "CANCELED", tradeIds: ["trade"] }, fills: [fill], complete: true, observedAt: 1 });
  expect(next).toMatchObject({ matched: "3", principal: "1.5", open: "0", terminal: true });
  expect(canCancelGtcOrder(next)).toBe(false);
});
it("unknown fees and missing trade details remain unresolved", () => {
  const next = mergeGtcOrderFacts(order(), { order: { id: "hash", original: "10", matched: "5", status: "LIVE", tradeIds: ["trade", "missing"] }, fills: [{ ...fill, fee: null }], complete: true, observedAt: 1 });
  expect(next.complete).toBe(false); expect(next.fee).toBeNull(); expect(next.error).toContain("费用待核实"); expect(next.error).toContain("明细缺失");
});
it("explicit FAILED evidence removes the fill and cannot be undone by stale successful replay", () => {
  let next = mergeGtcOrderFacts(order(), { order: { id: "hash", original: "10", matched: "3", status: "LIVE", tradeIds: ["trade"] }, fills: [fill], complete: true, observedAt: 1 });
  next = mergeGtcOrderFacts(next, { order: { id: "hash", original: "10", matched: "0", status: "CANCELED", tradeIds: ["trade"] }, fills: [{ ...fill, status: "FAILED", updatedAt: 2 }], complete: true, observedAt: 2 });
  next = mergeGtcOrderFacts(next, { order: null, fills: [fill], complete: true, observedAt: 1 });
  expect(next).toMatchObject({ matched: "0", principal: "0", open: "0", terminal: true });
  expect(next.fills[fill.key]!.status).toBe("FAILED");
});
it("rejects another original order even if its token and quantities look identical", () => {
  expect(() => mergeGtcOrderFacts(order(), { order: { id: "other", original: "10", matched: "0", status: "LIVE", tradeIds: [] }, fills: [], complete: true, observedAt: 1 })).toThrow("身份");
});
