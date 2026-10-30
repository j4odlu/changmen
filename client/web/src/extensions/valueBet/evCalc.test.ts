import { describe, expect, it } from "vitest";
import { removVig, valueBetFairOdds } from "./evCalc";

describe("PM baseline quality", () => {
  const pm = { sharp: "Polymarket" as const, pmMaxOverroundPct: 3 };

  it.each([
    [2, 1.96, true],
    [1.95, 1.95, true],
    [1.9, 1.9, false],
    [1.1, 1.1, false],
    [0, 2, false],
    [1, 2, false],
    [Number.NaN, 2, false],
    [Infinity, 2, false],
    [2.1, 2.1, false],
  ])("filters PM odds %s / %s", (home, away, accepted) => {
    expect(valueBetFairOdds(home, away, pm) !== null).toBe(accepted);
  });

  it("accepts the exact limit and rejects quotes above it", () => {
    expect(valueBetFairOdds(2, 1 / 0.53, pm)?.overround).toBeCloseTo(1.03);
    expect(valueBetFairOdds(2, 1 / 0.53001, pm)).toBeNull();
  });

  it("allows a zero-overround PM baseline even with a 0% limit", () => {
    expect(valueBetFairOdds(2, 2, { ...pm, pmMaxOverroundPct: 0 }))
      .toEqual({ fairHome: 2, fairAway: 2, overround: 1 });
    expect(valueBetFairOdds(2, 1.99, { ...pm, pmMaxOverroundPct: 0 })).toBeNull();
  });

  it.each(["PB", "OB", "RAY"] as const)("preserves %s baseline behavior", (sharp) => {
    expect(valueBetFairOdds(1.9, 1.9, { sharp, pmMaxOverroundPct: 0 })).toEqual(removVig(1.9, 1.9));
    expect(valueBetFairOdds(2, 2, { sharp })).toBeNull();
  });
});
