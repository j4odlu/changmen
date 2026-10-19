import { afterEach, describe, expect, it } from "vitest";
import {
  getPmFokDepthBufferPrefs,
  isPmFokDepthBufferActive,
  normalizePmFokDepthBufferMultiplier,
  pmFokDepthBufferNeedUsdc,
  pmFokDepthReuseMultiplier,
  pmFokFillPriceDepthUsdc,
  resetPmFokDepthBufferPrefsForTests,
  setPmFokDepthBufferPrefs,
} from "@changmen/venue-browser/polymarket/pmFokDepthBufferMode";

describe("pmFokDepthBufferMode", () => {
  afterEach(() => {
    resetPmFokDepthBufferPrefsForTests();
  });

  it("defaults disabled at 1.5", () => {
    expect(getPmFokDepthBufferPrefs()).toEqual({ enabled: false, multiplier: 1.5 });
    expect(isPmFokDepthBufferActive()).toBe(false);
    expect(pmFokDepthReuseMultiplier()).toBe(1);
  });

  it("setPmFokDepthBufferPrefs mirrors enabled + multiplier", () => {
    setPmFokDepthBufferPrefs({ enabled: true, multiplier: 2 });
    expect(getPmFokDepthBufferPrefs()).toEqual({ enabled: true, multiplier: 2 });
    expect(isPmFokDepthBufferActive()).toBe(true);
    expect(pmFokDepthReuseMultiplier()).toBe(2);
  });

  it("clamps invalid multiplier", () => {
    expect(normalizePmFokDepthBufferMultiplier(1)).toBe(1.5);
    expect(normalizePmFokDepthBufferMultiplier(11)).toBe(1.5);
    expect(normalizePmFokDepthBufferMultiplier(1.25)).toBe(1.3);
  });

  it("P and better ignores worse levels inside cap", () => {
    setPmFokDepthBufferPrefs({ enabled: true, multiplier: 1.5 });
    const asks = [
      { price: 0.5, size: 20 },
      { price: 0.54, size: 100 },
    ];
    expect(pmFokFillPriceDepthUsdc(asks, 0.5)).toBe(10);
    expect(pmFokFillPriceDepthUsdc(asks, 0.54)).toBe(64);
    expect(pmFokDepthBufferNeedUsdc(10)).toBe(15);
    expect(pmFokFillPriceDepthUsdc(asks, 0.5) + 1e-9 >= 15).toBe(false);
    expect(pmFokFillPriceDepthUsdc(asks, 0.54) + 1e-9 >= 15).toBe(true);
  });

  it("need is null when disabled", () => {
    expect(pmFokDepthBufferNeedUsdc(10)).toBeNull();
  });
});
