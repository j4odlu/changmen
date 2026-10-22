import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { claimLowOddsMarket, lowOddsExecutionSide, lowOddsMarketKeys, lowOddsMarketSubmitted } from "./lowOddsSingle";
import type { BetOption } from "@changmen/client-core/models/betOption";
import type { ViewBet, ViewMatch } from "@/models/match";

describe("low odds market submission budget", () => {
  let data: Map<string, string>;
  beforeEach(() => {
    data = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => { data.set(key, value); },
    });
    let tail = Promise.resolve();
    vi.stubGlobal("navigator", { locks: { request: (_key: string, action: () => boolean) => {
      const task = tail.then(action);
      tail = task.then(() => {}, () => {});
      return task;
    } } });
  });
  afterEach(() => vi.unstubAllGlobals());

  const leg = (type: string, id: string) => ({ type, matchId: "event", betId: id, odds: 2 }) as BetOption;
  const keys = (owner = "u", rowId = 1, legs = [leg("OB", "map1"), leg("RAY", "map1")]) =>
    lowOddsMarketKeys(owner, { id: 10 } as ViewMatch, { id: rowId } as ViewBet, legs);

  it("competing tabs get exactly one claim; direction/account changes and remerged row IDs stay consumed", async () => {
    const a = keys();
    expect(lowOddsMarketSubmitted(a)).toBe(false);
    const results = await Promise.all([claimLowOddsMarket(a), claimLowOddsMarket(a)]);
    expect(results.sort()).toEqual([false, true]);
    // A new aggregated row still shares the RAY native market with the original attempt.
    const remerged = keys("u", 99, [leg("RAY", "map1"), leg("PB", "map1")]);
    expect(lowOddsMarketSubmitted(remerged)).toBe(true);
    expect(await claimLowOddsMarket(remerged)).toBe(false);
    expect(await claimLowOddsMarket(keys("another-user"))).toBe(true);
    expect(await claimLowOddsMarket(keys("u", 2, [leg("OB", "map2"), leg("RAY", "map2")]))).toBe(true);
  });

  it("reloads storage every time, with no in-memory success counter to reset", async () => {
    expect(await claimLowOddsMarket(keys())).toBe(true);
    vi.resetModules();
    const reloaded = await import("./lowOddsSingle");
    expect(reloaded.lowOddsMarketSubmitted(keys())).toBe(true);
    expect(await reloaded.claimLowOddsMarket(keys())).toBe(false);
  });

  it("fails closed if storage is corrupt, unwritable, or the cross-tab lock is unavailable", async () => {
    data.set("LowOddsSingleSubmitted:v1", "invalid-json");
    expect(lowOddsMarketSubmitted(keys())).toBe(true);
    await expect(claimLowOddsMarket(keys())).rejects.toThrow();
    data.clear();
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => { throw new Error("quota"); } });
    await expect(claimLowOddsMarket(keys())).rejects.toThrow("quota");
    vi.stubGlobal("navigator", {});
    await expect(claimLowOddsMarket(keys())).rejects.toThrow("次数锁");
  });

  it("uses confirmed odds, rejects invalid or equal values", () => {
    const a = { odds: 1.5, newOdds: 2.4 } as BetOption;
    const b = { odds: 3, newOdds: 1.8 } as BetOption;
    expect(lowOddsExecutionSide(a, b)).toBe("B");
    expect(lowOddsExecutionSide(b, a)).toBe("A");
    expect(lowOddsExecutionSide(a, a)).toBeNull();
    expect(lowOddsExecutionSide({ odds: Number.NaN } as BetOption, b)).toBeNull();
  });
});
