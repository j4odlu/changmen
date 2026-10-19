import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { applyStakeLiveOdds } from "./liveOdds";
import { clearOddsAccess, registerOddsAccess, type VenueOddsEntry } from "@changmen/client-core/bridge/oddsAccess";

describe("applyStakeLiveOdds", () => {
  const saved: VenueOddsEntry[] = [];

  beforeEach(() => {
    saved.length = 0;
    registerOddsAccess({
      read: (_p, _id, fallback) => fallback || 0,
      save: (_p, entry) => {
        saved.push(entry);
      },
      clean: () => {},
      isOdds: () => false,
      getEntry: () => undefined,
      updateOddsLock: () => {},
      updateBetLock: () => {},
      updateMessage: () => {},
      getLimit: () => undefined,
      setLimit: () => {},
    });
  });

  afterEach(() => {
    clearOddsAccess();
  });

  test("writes home/away fo with isLock false like A8 LHe", () => {
    const n = applyStakeLiveOdds({
      matchId: "fx-1",
      bets: [
        { betId: "m1", homeId: "h1", awayId: "a1", home: 1.9, away: 1.85 },
      ],
    });
    expect(n).toBe(2);
    expect(saved).toHaveLength(2);
    expect(saved[0]).toMatchObject({ id: "h1", odds: 1.9, isLock: false, betId: "m1" });
    expect(saved[1]).toMatchObject({ id: "a1", odds: 1.85, isLock: false, betId: "m1" });
  });

  test("skips rows without both outcome ids", () => {
    expect(applyStakeLiveOdds({ bets: [{ betId: "m", homeId: "h", home: 2, away: 2 }] })).toBe(0);
    expect(saved).toHaveLength(0);
  });
});
