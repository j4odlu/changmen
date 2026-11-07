import type { BetOption } from "@changmen/client-core/models/betOption";
import {
  hedgeStakeCnyFromLeg,
  legStakeCny,
  splitPmA8Legs,
} from "@/domain/polymarket/pmArbStake";
import { BetOption as BetOptionClass } from "@changmen/client-core/models/betOption";
import { PlatformAccount as PlatformAccountClass } from "@/models/platformAccount";
import { describe, expect, it } from "vitest";

function leg(type: string, odds: number, betMoney: number): BetOption {
  return new BetOptionClass(type as never, "m1", "b1", "i1", betMoney, "Home", odds);
}

describe("pmArbStake", () => {
  it("converts PM USDT stake to CNY", () => {
    const pmAccount = new PlatformAccountClass({
      accountId: 1,
      provider: "Polymarket",
      playerName: "pm",
      currency: "USDT",
    });
    expect(legStakeCny(14, "Polymarket", pmAccount)).toBe(93.1);
  });

  it("hedgeStakeCnyFromLeg uses PM success stake in CNY", () => {
    const pmAccount = new PlatformAccountClass({
      accountId: 1,
      provider: "Polymarket",
      playerName: "pm",
      currency: "USDT",
    });
    expect(hedgeStakeCnyFromLeg(1.695, 14, "Polymarket", 2.63, pmAccount)).toBe(60);
  });

  it("splitPmA8Legs identifies PM leg on either side", () => {
    const legA = leg("RAY", 1.72, 18);
    const legB = leg("Polymarket", 2.632, 14);
    const pair = splitPmA8Legs(legA, legB);
    expect(pair.pmLeg).toBe(legB);
    expect(pair.a8Leg).toBe(legA);
  });
});
