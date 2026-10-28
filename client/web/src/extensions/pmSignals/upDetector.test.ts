import { describe, expect, it } from "vitest";
import { PmUpDetector, type PmUpObservation } from "./upDetector";
import { createDefaultPmUpPrefs } from "./upSettings";

function observation(odds: number, at: number, patch: Partial<PmUpObservation> = {}): PmUpObservation {
  return {
    key: "11:101:Home:pm-a", assetId: "pm-a", matchId: 11, betId: 101,
    matchTitle: "Alpha vs Beta", marketTitle: "地图1 获胜",
    pmSide: "Home", pmSideLabel: "Alpha", targetSide: "Away", targetSideLabel: "Beta",
    bestAsk: 1 / odds, receivedAt: at,
    targets: [{ provider: "OB", itemId: "ob-b", odds: 2 }], ...patch,
  };
}

function detector(patch = {}) {
  return new PmUpDetector({ ...createDefaultPmUpPrefs(), enabled: true, ...patch });
}

describe("PM rise and opposite-side arbitrage", () => {
  it("ignores first quotes and triggers the opposite venue when PM rises into arbitrage", () => {
    const d = detector();
    expect(d.push(observation(1.8, 1_000))).toEqual([]);
    const [signal] = d.push(observation(2.2, 2_000));
    expect(signal).toMatchObject({ pmSide: "Home", targetSide: "Away", target: { provider: "OB", odds: 2 } });
    expect(signal.beforeOdds).toBeCloseTo(1.8);
    expect(signal.arbPct).toBeCloseTo(4.76190476);
    expect(signal.risePct).toBeCloseTo(22.222222);
  });

  it("does not fire for a PM drop, an unchanged quote, or a venue-only price change", () => {
    const d = detector({ cooldownMs: 0 });
    d.push(observation(2.2, 1_000));
    expect(d.push(observation(2.1, 2_000))).toEqual([]);
    expect(d.push(observation(2.1, 3_000, { targets: [{ provider: "OB", itemId: "b", odds: 3 }] }))).toEqual([]);
  });

  it("requires positive arbitrage and respects both thresholds", () => {
    const d = detector({ minRisePct: 10, minArbPct: 5 });
    d.push(observation(1.8, 1_000));
    expect(d.push(observation(1.9, 2_000))).toEqual([]);
    expect(d.push(observation(2.2, 3_000))).toEqual([]);
    expect(d.push(observation(2.3, 4_000))).toHaveLength(1);
    const zero = detector({ minArbPct: 0 });
    zero.push(observation(1.8, 1_000));
    expect(zero.push(observation(2, 2_000))).toEqual([]);
  });

  it("uses the window low for cumulative rise but requires the latest tick to rise", () => {
    const d = detector({ minRisePct: 10 });
    d.push(observation(2, 1_000));
    expect(d.push(observation(2.1, 2_000))).toEqual([]);
    expect(d.push(observation(2.22, 3_000))).toHaveLength(1);
    expect(d.push(observation(2.21, 4_000))).toEqual([]);
  });

  it("keeps cooldown separate for each opposite venue and does not consume it on misses", () => {
    const d = detector();
    d.push(observation(1.8, 1_000));
    expect(d.push(observation(1.9, 2_000))).toEqual([]);
    expect(d.push(observation(2.2, 3_000))).toHaveLength(1);
    const targets: PmUpObservation["targets"] = [{ provider: "OB", itemId: "ob-b", odds: 2 }, { provider: "RAY", itemId: "ray-b", odds: 2 }];
    expect(d.push(observation(2.3, 4_000, { targets })).map(s => s.target.provider)).toEqual(["RAY"]);
    d.push(observation(2.3, 8_000, { targets }));
    d.push(observation(2.3, 12_000, { targets }));
    expect(d.push(observation(2.4, 13_000, { targets })).map(s => s.target.provider)).toEqual(["OB"]);
  });

  it("does not compare across stale gaps, invalid books, or backwards timestamps", () => {
    const d = detector({ cooldownMs: 0 });
    d.push(observation(1.8, 1_000));
    expect(d.push(observation(2.2, 7_000))).toEqual([]);
    expect(d.push(observation(1.8, 6_000))).toEqual([]);
    expect(d.push(observation(2.2, 7_500))).toEqual([]);
    d.push(observation(0, 8_000, { bestAsk: 0 }));
    expect(d.push(observation(2.3, 9_000))).toEqual([]);
  });

  it("preserves venue cooldown when a stale gap only resets the price baseline", () => {
    const d = detector();
    d.push(observation(1.8, 1_000));
    expect(d.push(observation(2.2, 2_000))).toHaveLength(1);
    // 行情间隔超过 5 秒窗口，但仍在上一信号的 10 秒冷却内。
    expect(d.push(observation(2.3, 8_000))).toEqual([]);
    expect(d.push(observation(2.4, 9_000))).toEqual([]);
    expect(d.push(observation(2.5, 12_000))).toHaveLength(1);
  });

  it("excludes unavailable quotes and PM targets and freezes historical target odds", () => {
    const d = detector();
    d.push(observation(1.8, 1_000));
    const quote = observation(2.2, 2_000, { targets: [
      { provider: "OB", itemId: "locked", odds: 0 },
      { provider: "RAY", itemId: "nan", odds: NaN },
      { provider: "Polymarket", itemId: "pm-b", odds: 2 },
      { provider: "PB", itemId: "pb-b", odds: 2 },
    ] });
    const signals = d.push(quote);
    expect(signals.map(s => s.target.provider)).toEqual(["PB"]);
    quote.targets[3].odds = 1.5;
    expect(signals[0].target.odds).toBe(2);
  });
});
