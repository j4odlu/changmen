import { describe, expect, it } from "vitest";
import { gtcOrderSnapshot } from "./pm_gtc_order_snapshot.js";

const execution = () => ({
  plan: { otherProvider: "RAY", otherPlayerId: 2, originalPmLeg: "A", shares: "28.160001" },
  revision: 7, submit: "accepted", matched: "6.860001", open: "0", principal: "3.567200",
  fee: "0", complete: true, observedAt: 123, order: { status: "CANCELED" },
});

describe("GTC order snapshot is supplementary, not execution or financial state", () => {
  it.each(["A", "B"])("copies the owned original %s quantities without recalculation or losing precision", (leg) => {
    const row = execution(); row.plan.originalPmLeg = leg;
    const before = structuredClone(row);
    expect(gtcOrderSnapshot(row)).toEqual({
      version: 1, timeInForce: "GTC", executionRevision: 7, requestedShares: "28.160001",
      cumulativeMatchedShares: "6.860001", openShares: "0", officialStatus: "CANCELED",
      submitState: "accepted", principalUsdc: "3.567200", feeUsdc: "0", factsComplete: true, observedAt: 123,
    });
    expect(row).toEqual(before);
  });
  it("preserves unknown, known zero and false as different facts", () => {
    const row = execution(); row.open = null; row.fee = null; row.complete = false; row.observedAt = 0; row.order = null;
    expect(gtcOrderSnapshot(row)).toMatchObject({ openShares: null, feeUsdc: null, factsComplete: false, observedAt: 0, officialStatus: null });
    row.open = "0"; row.fee = "0";
    expect(gtcOrderSnapshot(row)).toMatchObject({ openShares: "0", feeUsdc: "0" });
  });
  it("keeps a canceled automatic order in scope even if manual/released control flags changed", () => {
    expect(gtcOrderSnapshot({ ...execution(), manual: true, released: true })).toBeDefined();
  });
  it.each(["OB", "RAY", "IA", "SABA", "PB", "HG"])("recognizes only explicit traditional counterpart %s metadata", (provider) => {
    const row = execution(); row.plan.otherProvider = provider;
    expect(gtcOrderSnapshot(row)).toBeDefined();
  });
  it.each(["Polymarket", "PredictFun", "SXBet", "Limitless", "Azuro", "unknown", ""])("does not change non-target or unknown counterpart %s", (provider) => {
    const row = execution(); row.plan.otherProvider = provider;
    expect(gtcOrderSnapshot(row)).toBeUndefined();
  });
  it("does not infer a manual or malformed historical plan from current preferences", () => {
    const row = execution(); row.plan.source = "manual";
    expect(gtcOrderSnapshot(row)).toBeUndefined();
    delete row.plan.source; row.plan.otherPlayerId = 0;
    expect(gtcOrderSnapshot(row)).toBeUndefined();
    delete row.plan;
    expect(gtcOrderSnapshot(row)).toBeUndefined();
  });
});
