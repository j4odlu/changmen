import { describe, expect, it } from "vitest";
import { computeValueBetEdge, isValueBetPositiveEdge } from "@/extensions/valueBet/computeValueBetEdge";
import { valueBetCalcOptsFromPrefs } from "@/extensions/valueBet/evConfig";

function stubItem(type: string, home: number, away: number) {
  return {
    type,
    getOdds: (side: "Home" | "Away") => (side === "Home" ? home : away),
  };
}

describe("computeValueBetEdge sharp baseline", () => {
  const pb = stubItem("PB", 1.9, 1.95);
  const ray = stubItem("RAY", 2.2, 1.7);
  const ob = stubItem("OB", 2.3, 1.65);
  const bet = { items: [pb, ray, ob] };

  it("defaults to PB as sharp so PB itself is not marked", () => {
    expect(computeValueBetEdge(bet as never, pb as never, "Home")).toBeNull();
    const rayHome = computeValueBetEdge(bet as never, ray as never, "Home");
    expect(rayHome).not.toBeNull();
    expect(rayHome!.edge).toBeGreaterThan(0.03);
  });

  it("with RAY as sharp, can mark PB and not RAY", () => {
    const opts = valueBetCalcOptsFromPrefs({ sharp: "RAY" });
    expect(computeValueBetEdge(bet as never, ray as never, "Home", opts)).toBeNull();
    const pbHome = computeValueBetEdge(bet as never, pb as never, "Home", opts);
    expect(pbHome).not.toBeNull();
    expect(computeValueBetEdge(bet as never, ob as never, "Home", opts)).not.toBeNull();
  });

  it("with OB as sharp, can mark PB/RAY and not OB", () => {
    const opts = valueBetCalcOptsFromPrefs({ sharp: "OB" });
    expect(computeValueBetEdge(bet as never, ob as never, "Home", opts)).toBeNull();
    expect(computeValueBetEdge(bet as never, pb as never, "Home", opts)).not.toBeNull();
    expect(computeValueBetEdge(bet as never, ray as never, "Home", opts)).not.toBeNull();
  });

  it("uses PM prices for both sides and never marks PM itself", () => {
    const pm = stubItem("Polymarket", 1.6, 2.5);
    const pmBet = { items: [pb, ray, ob, pm] };
    const opts = valueBetCalcOptsFromPrefs({ sharp: "Polymarket" });
    expect(computeValueBetEdge(pmBet as never, pm as never, "Home", opts)).toBeNull();
    for (const item of [pb, ray, ob]) {
      const home = computeValueBetEdge(pmBet as never, item as never, "Home", opts)!;
      const away = computeValueBetEdge(pmBet as never, item as never, "Away", opts)!;
      expect(home.fairOdds).toBeCloseTo(1.64);
      expect(away.fairOdds).toBeCloseTo(2.5625);
      expect(home.edge).toBeCloseTo(item.getOdds("Home") / 1.64 - 1);
      expect(away.edge).toBeCloseTo(item.getOdds("Away") / 2.5625 - 1);
      expect(home.sharpHome).toBe(1.6);
      expect(home.sharpAway).toBe(2.5);
    }
    expect(computeValueBetEdge(bet as never, ray as never, "Home", opts)).toBeNull();
  });

  it("rejects poor PM quotes on recheck and honors a custom limit", () => {
    const pm = stubItem("Polymarket", 1.9, 1.9);
    const pmBet = { items: [pm, ray] };
    const opts = valueBetCalcOptsFromPrefs({ sharp: "Polymarket" });
    expect(computeValueBetEdge(pmBet as never, ray as never, "Home", opts)).toBeNull();
    const relaxed = { ...opts, pmMaxOverroundPct: 6 };
    expect(computeValueBetEdge(pmBet as never, ray as never, "Home", relaxed)?.edge).toBeCloseTo(0.1);
    pm.getOdds = () => 1.1;
    expect(computeValueBetEdge(pmBet as never, ray as never, "Home", relaxed)).toBeNull();
  });
});

describe("isValueBetPositiveEdge", () => {
  it("uses custom minEdge when provided", () => {
    expect(isValueBetPositiveEdge(0.04, 0.05)).toBe(false);
    expect(isValueBetPositiveEdge(0.05, 0.05)).toBe(true);
  });
});
