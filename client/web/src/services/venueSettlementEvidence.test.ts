import type { VenueOrder } from "@changmen/venue-adapter/contract";
import { BetOption } from "@changmen/client-core/models/betOption";
import { BetResult } from "@changmen/client-core/models/betResult";
import { describe, expect, it } from "vitest";
import { settlementEvidenceOrder, submissionVenueStatus } from "./venueSettlementEvidence";

const option = new BetOption("RAY", "38450996", "18304", "76390520", 100, "Home", 1.4);
const result = Object.assign(new BetResult("RAY", true), { beginTime: 1791393169828 });
const order = { provider: "RAY", orderId: "406855f4d96e6acdb1ee", venueMatchId: "38450996", venueItemId: "76390520",
  createAt: 1791393170000, betMoney: 100, odds: 1.4, status: "reject", venueRejectReason: "系统拒绝" } as VenueOrder;

describe("拒单检测关联证据", () => {
  it("associates the unique RAY order when the accepted POST has no order ID", () => {
    expect(settlementEvidenceOrder(option, result, [order])).toBe(order);
    expect(result.orderId).toBeNull();
    expect(result.success).toBe(true);
  });
  it.each([
    { venueMatchId: "other" }, { venueItemId: "other" }, { betMoney: 99 }, { odds: 1.5 },
    { createAt: result.beginTime - 10001 }, { createAt: result.beginTime + 120001 },
  ])("rejects unrelated order evidence: %j", patch => {
    expect(settlementEvidenceOrder(option, result, [{ ...order, ...patch }])).toBeUndefined();
  });
  it("does not associate ambiguous orders or a matching order that the existing detector did not select", () => {
    expect(settlementEvidenceOrder(option, result, [order, { ...order, orderId: "second" }])).toBeUndefined();
    expect(settlementEvidenceOrder(option, result, [{ ...order, venueItemId: "other" }, order])).toBeUndefined();
  });
  it("requires the exact ID when supplied instead of falling back to a latest order", () => {
    const submitted = Object.assign(new BetResult("RAY", true), { beginTime: result.beginTime, orderId: "missing" });
    expect(settlementEvidenceOrder(option, submitted, [order])).toBeUndefined();
    submitted.orderId = order.orderId;
    expect(settlementEvidenceOrder(option, submitted, [order])).toBe(order);
  });
  it("retains delayed identity after settlement clears pending", () => {
    const delayed = new BetResult("Polymarket", true, "", undefined, { status: "delayed" });
    expect(submissionVenueStatus(delayed)).toBe("delayed");
    expect(submissionVenueStatus(new BetResult("Polymarket", true, "", undefined, { status: "matched" }))).toBe("matched");
    expect(submissionVenueStatus(new BetResult("Polymarket", false))).toBeUndefined();
    expect(submissionVenueStatus(new BetResult("Polymarket", true))).toBeUndefined();
  });
});
