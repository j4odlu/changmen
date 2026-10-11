import { describe, expect, it, afterEach } from "vitest";
import {
  getPmArbPriceBufferPrefs,
  isPmArbPriceBufferActive,
  normalizePmArbPriceBufferMultiplier,
  pmEffectiveOddsFromFoEntry,
  pmExecCapFromRawAsk,
  resetPmArbPriceBufferPrefsForTests,
  resolvePolymarketExecMaxPrice,
  setPmArbPriceBufferPrefs,
} from "../../pmArbPriceBufferMode";

describe("pmArbPriceBufferMode", () => {
  afterEach(() => {
    resetPmArbPriceBufferPrefsForTests();
  });

  it("defaults disabled at 1.01", () => {
    expect(getPmArbPriceBufferPrefs()).toEqual({ enabled: false, multiplier: 1.01 });
    expect(isPmArbPriceBufferActive()).toBe(false);
  });

  it("setPmArbPriceBufferPrefs mirrors enabled + multiplier", () => {
    setPmArbPriceBufferPrefs({ enabled: true, multiplier: 1.03 });
    expect(getPmArbPriceBufferPrefs()).toEqual({ enabled: true, multiplier: 1.03 });
    expect(isPmArbPriceBufferActive()).toBe(true);
  });

  it("clamps invalid multiplier", () => {
    expect(normalizePmArbPriceBufferMultiplier(0.5)).toBe(1.01);
    expect(normalizePmArbPriceBufferMultiplier(2)).toBe(1.01);
  });

  it("pmExecCapFromRawAsk is identity when disabled", () => {
    expect(pmExecCapFromRawAsk(0.886)).toBe(0.886);
    expect(resolvePolymarketExecMaxPrice(0.68, 1.47)).toBe(0.68);
  });

  it("0.886 × 1.01 → execCap 0.8949 / effectiveOdds 1.117", () => {
    setPmArbPriceBufferPrefs({ enabled: true, multiplier: 1.01 });
    expect(pmExecCapFromRawAsk(0.886)).toBe(0.8949);
    expect(pmEffectiveOddsFromFoEntry({ clobPrice: 0.886, odds: 1.129, isLock: false })).toBe(1.117);
  });

  it("resolvePolymarketExecMaxPrice does not double-buffer 1/effectiveOdds rounding", () => {
    setPmArbPriceBufferPrefs({ enabled: true, multiplier: 1.01 });
    const fromOdds = Math.round((1 / 1.117) * 10000) / 10000;
    expect(fromOdds).toBe(0.8953);
    expect(resolvePolymarketExecMaxPrice(fromOdds, 1.117)).toBe(0.8953);
  });

  it("resolvePolymarketExecMaxPrice does not double-buffer when cap already matches odds", () => {
    setPmArbPriceBufferPrefs({ enabled: true, multiplier: 1.01 });
    expect(resolvePolymarketExecMaxPrice(0.8949, 1.117)).toBe(0.8949);
  });

  it("resolvePolymarketExecMaxPrice applies once to raw ask when odds do not match", () => {
    setPmArbPriceBufferPrefs({ enabled: true, multiplier: 1.01 });
    expect(resolvePolymarketExecMaxPrice(0.886, 1.117)).toBe(0.8949);
  });
});
