import { describe, expect, it, afterEach } from "vitest";
import {
  getPfArbPriceBufferPrefs,
  isPfArbPriceBufferActive,
  normalizePfArbPriceBufferMultiplier,
  pfEffectiveOddsFromFoEntry,
  pfExecCapFromRawAsk,
  resetPfArbPriceBufferPrefsForTests,
  resolvePredictFunExecMaxPrice,
  setPfArbPriceBufferPrefs,
} from "./pfArbPriceBufferMode";

describe("pfArbPriceBufferMode", () => {
  afterEach(() => {
    resetPfArbPriceBufferPrefsForTests();
  });

  it("defaults disabled at 1.01", () => {
    expect(getPfArbPriceBufferPrefs()).toEqual({ enabled: false, multiplier: 1.01 });
    expect(isPfArbPriceBufferActive()).toBe(false);
  });

  it("setPfArbPriceBufferPrefs mirrors enabled + multiplier", () => {
    setPfArbPriceBufferPrefs({ enabled: true, multiplier: 1.03 });
    expect(getPfArbPriceBufferPrefs()).toEqual({ enabled: true, multiplier: 1.03 });
    expect(isPfArbPriceBufferActive()).toBe(true);
  });

  it("clamps invalid multiplier", () => {
    expect(normalizePfArbPriceBufferMultiplier(0.5)).toBe(1.01);
    expect(normalizePfArbPriceBufferMultiplier(2)).toBe(1.01);
  });

  it("pfExecCapFromRawAsk is identity when disabled", () => {
    expect(pfExecCapFromRawAsk(0.886)).toBe(0.886);
    expect(resolvePredictFunExecMaxPrice(0.68, 1.47)).toBe(0.68);
  });

  it("0.886 × 1.01 → execCap 0.8949 / effectiveOdds 1.117", () => {
    setPfArbPriceBufferPrefs({ enabled: true, multiplier: 1.01 });
    expect(pfExecCapFromRawAsk(0.886)).toBe(0.8949);
    expect(pfEffectiveOddsFromFoEntry({ clobPrice: 0.886, odds: 1.129, isLock: false })).toBe(1.117);
  });

  it("resolvePredictFunExecMaxPrice does not double-buffer 1/effectiveOdds rounding", () => {
    setPfArbPriceBufferPrefs({ enabled: true, multiplier: 1.01 });
    const fromOdds = Math.round((1 / 1.117) * 10000) / 10000;
    expect(fromOdds).toBe(0.8953);
    expect(resolvePredictFunExecMaxPrice(fromOdds, 1.117)).toBe(0.8953);
  });

  it("resolvePredictFunExecMaxPrice does not double-buffer when cap already matches odds", () => {
    setPfArbPriceBufferPrefs({ enabled: true, multiplier: 1.01 });
    expect(resolvePredictFunExecMaxPrice(0.8949, 1.117)).toBe(0.8949);
  });

  it("resolvePredictFunExecMaxPrice applies once to raw ask when odds do not match", () => {
    setPfArbPriceBufferPrefs({ enabled: true, multiplier: 1.01 });
    expect(resolvePredictFunExecMaxPrice(0.886, 1.117)).toBe(0.8949);
  });
});
