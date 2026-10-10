import type { GtcPlan } from "@changmen/shared/pm_gtc";
import { createGtcExecution } from "@changmen/shared/pm_gtc";
import { describe, expect, it } from "vitest";
import { gtcExecutionResult } from "./result";

function record() {
  return createGtcExecution("g", "owner", "wallet", "maker", { shares: "10", originalPmLeg: "A", otherProvider: "RAY" } as GtcPlan, 1);
}

describe("execution result separates acceptance, fills and group completion", () => {
  it("acceptance alone cannot become verified fill or group completion", () => {
    const row = record(); row.pmAuthorized = true; row.submit = "accepted"; row.orderId = "pm";
    expect(gtcExecutionResult(row)).toMatchObject({ pm: { submission: "accepted", fill: "unknown", orderType: "GTC" }, other: { orderType: "venue-default" }, groupComplete: false, responsibility: "manual" });
  });
  it("positive partial shares stay partial while the counterpart can be full", () => {
    const row = record(); Object.assign(row, { pmAuthorized: true, submit: "accepted", complete: true, matched: "5", open: "5" }); row.other.state = "filled";
    expect(gtcExecutionResult(row)).toMatchObject({ pm: { fill: "partial", matchedShares: "5", remainingShares: "5" }, other: { fill: "full" }, groupComplete: false });
  });
  it("late facts can retain full shares without inventing a completed group", () => {
    const row = record(); Object.assign(row, { pmAuthorized: true, submit: "accepted", complete: true, matched: "10", error: "missing trade evidence" });
    expect(gtcExecutionResult(row)).toMatchObject({ pm: { fill: "unknown", matchedShares: "10" }, groupComplete: false });
  });
  it("manual originals have no invented second leg", () => {
    const row = record(); row.plan.source = "manual";
    expect(gtcExecutionResult(row)).toMatchObject({ source: "manual", other: null });
  });
});
