import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { saveVenueOdds, getVenueOddsEntry } from "@changmen/client-core/bridge/oddsAccess";
import { PLATFORMS } from "@changmen/venue-browser/adapter/shared";

describe("oddsAccess bridge preserves PredictFun marketId", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("saveVenueOdds → getVenueOddsEntry keeps marketId (PF checkBet fo path)", () => {
    saveVenueOdds(PLATFORMS.PredictFun, {
      id: "token-yes",
      odds: 1.8,
      isLock: false,
      time: Date.now(),
      clobPrice: 0.55,
      marketId: "844582",
      betId: "bet-1",
      side: "home",
    }, "http");

    const row = getVenueOddsEntry(PLATFORMS.PredictFun, "token-yes");
    expect(row?.marketId).toBe("844582");
    expect(row?.clobPrice).toBe(0.55);
  });

  it("mqtt save does not drop marketId when rewriting odds", () => {
    saveVenueOdds(PLATFORMS.PredictFun, {
      id: "token-yes",
      odds: 1.8,
      isLock: false,
      time: Date.now(),
      clobPrice: 0.55,
      marketId: "844582",
    }, "http");

    saveVenueOdds(PLATFORMS.PredictFun, {
      id: "token-yes",
      odds: 1.9,
      isLock: false,
      time: Date.now(),
      clobPrice: 0.52,
      marketId: "844582",
    }, "mqtt");

    expect(getVenueOddsEntry(PLATFORMS.PredictFun, "token-yes")?.marketId).toBe("844582");
  });

  it("preserves prior marketId when a later save omits it", () => {
    saveVenueOdds(PLATFORMS.PredictFun, {
      id: "token-yes",
      odds: 1.8,
      isLock: false,
      time: Date.now(),
      clobPrice: 0.55,
      marketId: "844582",
    }, "http");

    saveVenueOdds(PLATFORMS.PredictFun, {
      id: "token-yes",
      odds: 2.0,
      isLock: false,
      time: Date.now(),
      clobPrice: 0.5,
    }, "mqtt");

    expect(getVenueOddsEntry(PLATFORMS.PredictFun, "token-yes")?.marketId).toBe("844582");
  });

  it("writeVenueOdds without marketId does not wipe fo cache (BetOption.updateOdds path)", async () => {
    const { writeVenueOdds } = await import("@changmen/client-core/bridge/oddsAccess");
    saveVenueOdds(PLATFORMS.PredictFun, {
      id: "token-yes",
      odds: 1.8,
      isLock: false,
      time: Date.now(),
      clobPrice: 0.55,
      marketId: "844582",
      betId: "bet-1",
    }, "http");

    writeVenueOdds(PLATFORMS.PredictFun, {
      id: "token-yes",
      odds: 1.85,
      betId: "bet-1",
    });

    expect(getVenueOddsEntry(PLATFORMS.PredictFun, "token-yes")?.marketId).toBe("844582");
  });
});
