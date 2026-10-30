import { beforeEach, describe, expect, it } from "vitest";
import {
  collectValueBetAutoCandidates,
  isValueBetAutoCooling,
  isValueBetAutoEligible,
  markValueBetAutoCooldown,
  resetValueBetAutoBetForTests,
} from "@/extensions/valueBet/valueBetAutoBet";
import { valueBetCalcOptsFromPrefs } from "@/extensions/valueBet/evConfig";
import {
  resetPrematchFullOnlyForTests,
  setPrematchFullMode,
} from "@/extensions/prematchFullOnly";

describe("isValueBetAutoEligible", () => {
  const base = {
    enabled: true,
    edge: 0.05,
    minEdge: 0.03,
    maxEdge: 0.2,
    sharpOdds: 1.9,
    minOdds: 1.3,
    maxOdds: 10,
    mapCount: 0,
    maxPerMap: 1,
  };

  it("passes when edge, sharp odds and map count fit", () => {
    expect(isValueBetAutoEligible(base)).toBe(true);
  });

  it("rejects inverted or non-finite edge/odds bounds", () => {
    expect(isValueBetAutoEligible({ ...base, minEdge: 0.08, maxEdge: 0.03 })).toBe(false);
    expect(isValueBetAutoEligible({ ...base, minEdge: Number.NaN })).toBe(false);
    expect(isValueBetAutoEligible({ ...base, minOdds: Number.NaN })).toBe(false);
  });

  it("rejects disabled / edge out of range / odds out of range / map full", () => {
    expect(isValueBetAutoEligible({ ...base, enabled: false })).toBe(false);
    expect(isValueBetAutoEligible({ ...base, edge: 0.029 })).toBe(false);
    expect(isValueBetAutoEligible({ ...base, edge: 0.21 })).toBe(false);
    expect(isValueBetAutoEligible({ ...base, sharpOdds: 1.2 })).toBe(false);
    expect(isValueBetAutoEligible({ ...base, sharpOdds: 10.1 })).toBe(false);
    expect(isValueBetAutoEligible({ ...base, mapCount: 1, maxPerMap: 1 })).toBe(false);
  });
});

describe("collectValueBetAutoCandidates", () => {
  beforeEach(() => {
    resetPrematchFullOnlyForTests();
  });

  function stubItem(type: string, home: number, away: number) {
    return {
      type,
      getOdds: (side: "Home" | "Away") => (side === "Home" ? home : away),
    };
  }

  it.each(["PB", "Polymarket"])("picks soft Home vs %s when edge and sharp odds pass", (sharp) => {
    const pb = stubItem(sharp, 1.95, 1.95);
    const ray = stubItem("RAY", 2.2, 1.7);
    const bet = { round: 1, items: [pb, ray] };
    const match = { id: 9, liveRound: 0, bets: [bet] };
    const calcOpts = valueBetCalcOptsFromPrefs({ sharp });
    const rows = collectValueBetAutoCandidates(
      [match] as never,
      calcOpts,
      { enabled: true, minEdgePct: 3, maxEdgePct: 20, minOdds: 1.3, maxOdds: 10, maxPerMap: 1 },
      {
        isMuted: () => false,
        mapCount: () => 0,
        isCooling: () => false,
      },
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].item.type).toBe("RAY");
    expect(rows[0].side).toBe("Home");
    expect(rows[0].snap.edge).toBeGreaterThan(0.03);
  });

  it("skips muted maps and full map count", () => {
    const pb = stubItem("PB", 1.9, 1.95);
    const ray = stubItem("RAY", 2.2, 1.7);
    const bet = { round: 1, items: [pb, ray] };
    const match = { id: 9, liveRound: 0, bets: [bet] };
    const calcOpts = valueBetCalcOptsFromPrefs({ sharp: "PB" });
    expect(collectValueBetAutoCandidates(
      [match] as never,
      calcOpts,
      { enabled: true, minEdgePct: 3, maxEdgePct: 20, minOdds: 1.3, maxOdds: 10, maxPerMap: 1 },
      { isMuted: () => true, mapCount: () => 0, isCooling: () => false },
    )).toEqual([]);
    expect(collectValueBetAutoCandidates(
      [match] as never,
      calcOpts,
      { enabled: true, minEdgePct: 3, maxEdgePct: 20, minOdds: 1.3, maxOdds: 10, maxPerMap: 1 },
      { isMuted: () => false, mapCount: () => 1, isCooling: () => false },
    )).toEqual([]);
  });

  it("skips a poor PM baseline and respects a custom overround limit", () => {
    const pm = stubItem("Polymarket", 1.9, 1.9);
    const ray = stubItem("RAY", 2.2, 1.7);
    const match = { id: 9, liveRound: 0, bets: [{ round: 1, items: [pm, ray] }] };
    const auto = { enabled: true, minEdgePct: 3, maxEdgePct: 20, minOdds: 1.3, maxOdds: 10, maxPerMap: 1 };
    const deps = { isMuted: () => false, mapCount: () => 0, isCooling: () => false };
    expect(collectValueBetAutoCandidates([match] as never, valueBetCalcOptsFromPrefs({ sharp: "Polymarket" }), auto, deps))
      .toEqual([]);
    const rows = collectValueBetAutoCandidates(
      [match] as never,
      valueBetCalcOptsFromPrefs({ sharp: "Polymarket", pmMaxOverroundPct: 6 }),
      auto,
      deps,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].item.type).toBe("RAY");
    expect(rows[0].snap.edge).toBeCloseTo(0.1);
  });

  it("skips when edge is above the auto max", () => {
    const pb = stubItem("PB", 1.9, 1.95);
    const ray = stubItem("RAY", 2.2, 1.7);
    const bet = { round: 1, items: [pb, ray] };
    const match = { id: 9, liveRound: 0, bets: [bet] };
    const calcOpts = valueBetCalcOptsFromPrefs({ sharp: "PB" });
    expect(collectValueBetAutoCandidates(
      [match] as never,
      calcOpts,
      { enabled: true, minEdgePct: 3, maxEdgePct: 3.1, minOdds: 1.3, maxOdds: 10, maxPerMap: 1 },
      { isMuted: () => false, mapCount: () => 0, isCooling: () => false },
    )).toEqual([]);
  });

  it("skips when sharp quoted odds are outside the range", () => {
    const pb = stubItem("PB", 1.9, 1.95);
    const ray = stubItem("RAY", 2.2, 1.7);
    const bet = { round: 1, items: [pb, ray] };
    const match = { id: 9, liveRound: 0, bets: [bet] };
    const calcOpts = valueBetCalcOptsFromPrefs({ sharp: "PB" });
    expect(collectValueBetAutoCandidates(
      [match] as never,
      calcOpts,
      { enabled: true, minEdgePct: 3, maxEdgePct: 20, minOdds: 2.0, maxOdds: 10, maxPerMap: 1 },
      { isMuted: () => false, mapCount: () => 0, isCooling: () => false },
    )).toEqual([]);
  });

  it("[changmen 扩展] 赛前全场模式下跳过地图盘", () => {
    setPrematchFullMode("liveRound");
    const pb = stubItem("PB", 1.9, 1.95);
    const ray = stubItem("RAY", 2.2, 1.7);
    const bet = { round: 1, items: [pb, ray] };
    const match = { id: 9, liveRound: 0, startAt: Date.now() + 86_400_000, bets: [bet] };
    const calcOpts = valueBetCalcOptsFromPrefs({ sharp: "PB" });
    expect(collectValueBetAutoCandidates(
      [match] as never,
      calcOpts,
      { enabled: true, minEdgePct: 3, maxEdgePct: 20, minOdds: 1.3, maxOdds: 10, maxPerMap: 1 },
      { isMuted: () => false, mapCount: () => 0, isCooling: () => false },
    )).toEqual([]);
  });
});

describe("valueBet auto cooldown", () => {
  it("blocks the same match:round until the window elapses", () => {
    resetValueBetAutoBetForTests();
    const now = 1_000_000;
    expect(isValueBetAutoCooling(9, 1, now)).toBe(false);
    markValueBetAutoCooldown(9, 1, now);
    expect(isValueBetAutoCooling(9, 1, now + 4_000)).toBe(true);
    expect(isValueBetAutoCooling(9, 1, now + 5_000)).toBe(false);
    expect(isValueBetAutoCooling(9, 0, now + 4_000)).toBe(false);
    resetValueBetAutoBetForTests();
  });
});
