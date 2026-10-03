import { describe, expect, it } from "vitest";
import { BetOption } from "@changmen/client-core/models/betOption";
import {
  applyArbHedgeStakes,
  impliedFromLegOdds,
  initialArbBaseStake,
} from "@changmen/arb-core";
import { createDefaultUserConfig } from "@/types/userConfig";

function leg(type: string, odds: number, betMoney: number): BetOption {
  return new BetOption(type as never, "m1", "b1", "i1", betMoney, "Home", odds);
}

describe("arbStakeMath (A8)", () => {
  it.each([[1.5, 3], [3, 1.5], [2, 2]])("splits total stakes for odds %s / %s", (oddsA, oddsB) => {
    const config = { ...createDefaultUserConfig(), betMoney: 150, betMoneyMode: "total" as const };
    const legA = leg("RAY", oddsA, 0);
    const legB = leg("PB", oddsB, 0);
    applyArbHedgeStakes(legA, legB, initialArbBaseStake(oddsA, oddsB, config), config);
    expect(legA.betMoney + legB.betMoney).toBeCloseTo(150);
    expect(legA.betMoney * oddsA).toBeCloseTo(legB.betMoney * oddsB);
  });

  it("keeps the default and legacy low-odds stake unchanged", () => {
    const config = createDefaultUserConfig();
    expect(initialArbBaseStake(1.5, 3, config)).toBe(100);
    delete config.betMoneyMode;
    expect(initialArbBaseStake(1.5, 3, config)).toBe(100);
  });

  it("retains hedge rounding in total mode", () => {
    const config = { ...createDefaultUserConfig(), betMoney: 100, betMoneyMode: "total" as const, tenNumber: true };
    const legA = leg("RAY", 1.5, 0);
    const legB = leg("PB", 3, 0);
    applyArbHedgeStakes(legA, legB, initialArbBaseStake(1.5, 3, config), config);
    expect(legA.betMoney).toBeCloseTo(100 * 2 / 3);
    expect(legB.betMoney).toBe(30);
  });

  it("computes implied from leg odds", () => {
    expect(impliedFromLegOdds(leg("RAY", 1.36, 80), leg("PB", 3.125, 35)))
      .toBeCloseTo(0.948, 3);
    expect(impliedFromLegOdds(leg("RAY", 1.36, 80), leg("PB", 5, 22)))
      .toBeCloseTo(1.07, 2);
  });

  it("recalculates hedge stake after odds move", () => {
    const config = createDefaultUserConfig();
    const legA = leg("RAY", 1.36, 80);
    const legB = leg("PB", 3.125, 20);
    applyArbHedgeStakes(legA, legB, 80, config);
    expect(legA.betMoney).toBe(80);
    expect(legB.betMoney).toBeCloseTo(35, 0);
  });
});
