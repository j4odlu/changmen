import type { GtcExecution, GtcPlan } from "@changmen/shared/pm_gtc";
import { applyGtcCommand, createGtcExecution, mergeGtcFacts } from "@changmen/shared/pm_gtc";
import { describe, expect, it } from "vitest";
import { gtcOriginalOrderActions, orderExecutionActions, orderExecutionIdentity } from "./executionIdentity";

const hash = `0x${"a".repeat(64)}`;
function original(): GtcExecution {
  const row = createGtcExecution("g", "owner", "wallet", "maker", { shares: "10", orderHash: hash } as GtcPlan, 1);
  return mergeGtcFacts(applyGtcCommand(applyGtcCommand(row, { kind: "authorize_pm" }, 2), { kind: "ack", state: "accepted", orderId: hash }, 3), {
    order: { id: hash, original: "10", matched: "0", status: "LIVE", tradeIds: [] },
    fills: [],
    complete: true,
    observedAt: 4,
  });
}

describe("original order identity and operations", () => {
  it("distinguishes the GTC PM buy from its venue-default counterpart and FOK child sell", () => {
    expect(orderExecutionIdentity({ Type: "Polymarket", PmGtcExecutionId: "g" })).toMatchObject({ executionKind: "pm-gtc-v1", orderType: "GTC", side: "buy" });
    expect(orderExecutionIdentity({ Type: "RAY", PmGtcExecutionId: "g" })).toMatchObject({ executionKind: "pm-gtc-v1", orderType: "venue-default" });
    expect(orderExecutionIdentity({ Type: "Polymarket", PmGtcExecutionId: "g", PmSide: "sell" })).toMatchObject({ executionKind: "pm-gtc-v1", orderType: "FOK", side: "sell" });
  });
  it("a shared Link neither changes FOK type nor supplies GTC execution identity", () => {
    expect(orderExecutionIdentity({ Type: "Polymarket", Link: 1 })).toMatchObject({ executionKind: "fok", executionId: null, orderType: "FOK" });
    expect(orderExecutionIdentity({ Type: "Polymarket", PmOrigin: "external" }).orderType).toBe("unknown");
  });
  it("gTC group membership cannot give a counterpart or FOK sell a GTC cancel button", () => {
    for (const row of [{ Type: "RAY", PmGtcExecutionId: "g" }, { Type: "Polymarket", PmGtcExecutionId: "g", PmSide: "sell" as const }, { Type: "Polymarket" }])
      expect(orderExecutionActions(orderExecutionIdentity(row), { submitted: true, canCancel: true })).toEqual({ showCancel: false, canCancel: false });
  });
  it("unsubmitted GTC has no cancel action; a zero-fill live original does", () => {
    expect(gtcOriginalOrderActions(createGtcExecution("g", "owner", "wallet", "maker", { shares: "10" } as GtcPlan, 1)).showCancel).toBe(false);
    expect(gtcOriginalOrderActions(original())).toMatchObject({ showCancel: true, canCancel: true });
  });
  it.each(["DELAYED", "CANCELED"])("%s facts disable the original action", (status) => {
    const row = original();
    row.order!.status = status;
    row.terminal = status === "CANCELED";
    expect(gtcOriginalOrderActions(row)).toMatchObject({ showCancel: true, canCancel: false });
  });
  it("unknown submission remains visible but cannot dispatch cancellation", () => {
    const row = original(); row.orderId = null; row.submit = "unknown";
    expect(gtcOriginalOrderActions(row)).toMatchObject({ showCancel: true, canCancel: false });
  });
});
