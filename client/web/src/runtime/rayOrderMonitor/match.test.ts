import type { VenueOrder } from "@changmen/venue-adapter/contract";
import type { RayOrderContext } from "./types";
import { describe, expect, it } from "vitest";
import { matchRayVenueOrder } from "./match";

function task(overrides: Partial<RayOrderContext> = {}): RayOrderContext {
  return {
    key: "u1:100:B:2",
    userId: "u1",
    linkId: 100,
    matchId: 1,
    betId: 10,
    side: "B",
    accountId: 2,
    submittedAt: 10_000,
    match: "Alpha vs Beta",
    bet: "[地图1] 获胜",
    item: "Beta",
    target: "Away",
    odds: 2.06,
    betMoney: 70,
    anchorConfirmed: true,
    anchorProvider: "Polymarket",
    anchorAccountId: 1,
    anchorBetMoney: 10,
    anchorOdds: 2.2,
    status: "binding",
    candidateCount: 0,
    pollCount: 0,
    updatedAt: 10_000,
    ...overrides,
  };
}

function order(orderId: string, overrides: Partial<VenueOrder> = {}): VenueOrder {
  return {
    provider: "RAY",
    orderId,
    odds: 2.06,
    createAt: 10_500,
    betMoney: 70,
    reward: 0,
    money: 0,
    status: "none",
    game: "cs2",
    match: "Alpha -VS- Beta",
    bet: "[地图1] 获胜",
    item: "Beta",
    ...overrides,
  };
}

describe("matchRayVenueOrder", () => {
  it("binds a unique order using time, money, odds and labels", () => {
    const result = matchRayVenueOrder(task(), [
      order("old", { createAt: 1_000, betMoney: 50 }),
      order("exact"),
    ]);

    expect(result.kind).toBe("matched");
    if (result.kind === "matched")
      expect(result.candidate.order.orderId).toBe("exact");
  });

  it("refuses to guess when two candidates are equally likely", () => {
    const result = matchRayVenueOrder(task(), [
      order("a"),
      order("b", { createAt: 10_600 }),
    ]);

    expect(result.kind).toBe("ambiguous");
  });

  it("rejects candidates with materially different stake or odds", () => {
    const result = matchRayVenueOrder(task(), [
      order("wrong-money", { betMoney: 100 }),
      order("wrong-odds", { odds: 1.7 }),
    ]);

    expect(result.kind).toBe("missing");
  });
});
