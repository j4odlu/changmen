import { describe, expect, it } from "vitest";
import { LoseOrder } from "@/models/loseOrder";
import {
  calcMakeupPlanProfitRate,
  checkMakeupProfitRateCandidate,
  filterMakeupOddsBandCandidates,
  isMakeupOddsBandEnabled,
  makeupDisplayBand,
  makeupDisplayOdds,
  previewMakeupOddsBand,
  resolveMakeupOddsBandBounds,
} from "@/extensions/arbBet/makeupOddsBand";
import type { MakeupOddsBandPrefs } from "@/types/extensionPrefs";

const on: MakeupOddsBandPrefs = { enabled: true, upper: 1.02, lower: 0.96 };
const off: MakeupOddsBandPrefs = { enabled: false, upper: 1.02, lower: 0.96 };

function item(odds: number, type = "OB") {
  return { type, odds };
}

describe("makeupOddsBand", () => {
  it("is off unless enabled === true", () => {
    expect(isMakeupOddsBandEnabled(undefined)).toBe(false);
    expect(isMakeupOddsBandEnabled(off)).toBe(false);
    expect(isMakeupOddsBandEnabled(on)).toBe(true);
  });

  it("filled=2 default band is 打平2 × 0.96/1.02", () => {
    const bounds = previewMakeupOddsBand(2, on);
    expect(bounds?.breakEvenOdds).toBe(2);
    expect(bounds?.lowerOdds).toBeCloseTo(1.92, 3);
    expect(bounds?.upperOdds).toBeCloseTo(2.04, 3);
  });

  it("uses break-even of the filled leg, not the filled odds themselves", () => {
    const bounds = previewMakeupOddsBand(1.8, on);
    expect(bounds?.breakEvenOdds).toBeCloseTo(2.25, 2);
    expect(bounds?.lowerOdds).toBeCloseTo(2.25 * 0.96, 2);
    expect(bounds?.upperOdds).toBeCloseTo(2.25 * 1.02, 2);
  });

  it("skips 2.20 when filled is 1.8 (in BE band, would be a false profit if using filled×k)", () => {
    const out = filterMakeupOddsBandCandidates([item(2.20)], i => i.odds, 1.8, on);
    expect(out).toEqual([]);
  });

  it("places 2.00 as a loss when filled is 1.8 (below BE×0.96)", () => {
    const out = filterMakeupOddsBandCandidates([item(2.00)], i => i.odds, 1.8, on);
    expect(out?.map(i => i.odds)).toEqual([2]);
  });

  it("lower 0 disables the loss side", () => {
    const bounds = resolveMakeupOddsBandBounds(2, { enabled: true, upper: 1.02, lower: 0 });
    expect(bounds?.lowerOdds).toBeNull();
    expect(bounds?.upperOdds).toBeCloseTo(2.04, 3);
  });

  it("skips the whole tick when best odds sit in the band", () => {
    const filled = 2;
    const items = [item(2.00), item(1.85)];
    const out = filterMakeupOddsBandCandidates(items, i => i.odds, filled, on);
    expect(out).toEqual([]);
  });

  it("does not fall through to a worse quote while best is in-band", () => {
    const out = filterMakeupOddsBandCandidates(
      [item(2.00, "OB"), item(1.80, "RAY")],
      i => i.odds,
      2,
      on,
    );
    expect(out).toEqual([]);
  });

  it("keeps only quotes above the upper bound when best is above", () => {
    const out = filterMakeupOddsBandCandidates(
      [item(2.10, "OB"), item(2.00, "RAY"), item(1.80, "IA")],
      i => i.odds,
      2,
      on,
    );
    expect(out?.map(i => i.type)).toEqual(["OB"]);
  });

  it("places from the least-bad quote when best is below the lower bound", () => {
    const out = filterMakeupOddsBandCandidates(
      [item(1.80, "OB"), item(1.70, "RAY")],
      i => i.odds,
      2,
      on,
    );
    expect(out?.map(i => i.type)).toEqual(["OB", "RAY"]);
  });

  it("treats a cleared lower as default 0.96, not as disable-loss", () => {
    const out = filterMakeupOddsBandCandidates(
      [item(2.00)],
      i => i.odds,
      2,
      { enabled: true, upper: 1.02, lower: null as unknown as number },
    );
    expect(out).toEqual([]);
  });

  it("returns null when break-even cannot be solved so caller can fall back", () => {
    const out = filterMakeupOddsBandCandidates(
      [item(2.00)],
      i => i.odds,
      1,
      { enabled: true, upper: 1.02, lower: 0.96 },
    );
    expect(out).toBeNull();
  });

  it("display odds match getOdds(makeProfit) when the band is off", () => {
    const order = new LoseOrder({ betOdds: 2, isCreateOrder: false });
    expect(makeupDisplayOdds(order, 1.01, off)).toBe(order.getOdds(1.01));
    expect(makeupDisplayOdds(order, 1.01, undefined)).toBe(order.getOdds(1.01));
  });

  it("display odds use break-even when the band is on", () => {
    const order = new LoseOrder({ betOdds: 2, isCreateOrder: false });
    expect(makeupDisplayOdds(order, 1.01, on)).toBe(2);
  });

  it("display odds stay on typed odds for manual isCreateOrder", () => {
    const order = new LoseOrder({ betOdds: 1.88, isCreateOrder: true });
    expect(makeupDisplayOdds(order, 1.01, on)).toBe(1.88);
  });

  describe("display band", () => {
    const order = { betOdds: 2, isCreateOrder: false };

    it("shows the same strict boundaries used by odds-factor filtering", () => {
      expect(makeupDisplayBand(order, on)).toEqual({
        breakEvenOdds: 2, lowerOdds: 1.92, upperOdds: 2.04, approximate: false,
      });
      expect(filterMakeupOddsBandCandidates([item(1.92)], i => i.odds, 2, on)).toEqual([]);
      expect(filterMakeupOddsBandCandidates([item(2.04)], i => i.odds, 2, on)).toEqual([]);
    });

    it("omits the band for disabled, manual and invalid orders", () => {
      expect(makeupDisplayBand(order, off)).toBeNull();
      expect(makeupDisplayBand(order)).toBeNull();
      expect(makeupDisplayBand({ ...order, isCreateOrder: true }, on)).toBeNull();
      expect(makeupDisplayBand({ ...order, betOdds: 1 }, on)).toBeNull();
      expect(makeupDisplayBand(order, { ...on, lower: 0 })?.lowerOdds).toBeNull();
    });

    it("converts profit percentages to approximate odds instead of reusing factors", () => {
      const band = makeupDisplayBand(order, {
        ...on, mode: "profitRate", upperProfitPct: 4, lowerLossPct: 3,
      });
      expect(band).toEqual({
        breakEvenOdds: 2, upperOdds: 2.167, lowerOdds: 1.883, approximate: true,
      });
      const upperOdds = band!.upperOdds!;
      const lowerOdds = band!.lowerOdds!;
      expect(calcMakeupPlanProfitRate(100, 2, 200 / upperOdds, upperOdds)).toBeCloseTo(0.04, 3);
      expect(calcMakeupPlanProfitRate(100, 2, 200 / lowerOdds, lowerOdds)).toBeCloseTo(-0.03, 3);
    });

    it("represents unreachable profit-rate boundaries without Infinity or NaN", () => {
      expect(makeupDisplayBand(order, {
        ...on, mode: "profitRate", upperProfitPct: 100, lowerLossPct: 100,
      })).toEqual({ breakEvenOdds: 2, upperOdds: null, lowerOdds: null, approximate: true });
    });
  });

  describe("profit-rate mode", () => {
    const profitMode: MakeupOddsBandPrefs = {
      enabled: true,
      mode: "profitRate",
      upper: 1.02,
      lower: 0.96,
      upperProfitPct: 4,
      lowerLossPct: 3,
    };
    const context = {
      filledStake: 100,
      getMakeupStake: (_item: { odds: number }, odds: number) => Math.round(200 / odds),
    };

    it("calculates guaranteed profit over total stake", () => {
      expect(calcMakeupPlanProfitRate(300, 1.87, 239, 2.35)).toBeCloseTo(22 / 539, 8);
    });

    it("skips when the best candidate is inside the configured range", () => {
      const out = filterMakeupOddsBandCandidates(
        [item(2.05), item(1.8)],
        i => i.odds,
        2,
        profitMode,
        context,
      );
      expect(out).toEqual([]);
    });

    it("keeps only candidates above the profit upper bound", () => {
      const out = filterMakeupOddsBandCandidates(
        [item(2.2, "OB"), item(2.05, "RAY"), item(1.8, "IA")],
        i => i.odds,
        2,
        profitMode,
        context,
      );
      expect(out?.map(i => i.type)).toEqual(["OB"]);
    });

    it("places from the best quote when even it is below the loss bound", () => {
      const out = filterMakeupOddsBandCandidates(
        [item(1.8, "OB"), item(1.7, "RAY")],
        i => i.odds,
        2,
        profitMode,
        context,
      );
      expect(out?.map(i => i.type)).toEqual(["OB", "RAY"]);
    });

    it("keeps exact profit and loss boundaries inside the no-bet range", () => {
      expect(checkMakeupProfitRateCandidate(100, 2.08, 100, 2.08, profitMode)).toEqual({
        allowed: false,
        rate: 0.04,
      });
      expect(checkMakeupProfitRateCandidate(100, 1.94, 100, 1.94, profitMode)?.allowed).toBe(false);
    });
  });
});
