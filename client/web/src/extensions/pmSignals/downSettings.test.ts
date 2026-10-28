import { afterEach, describe, expect, it } from "vitest";
import { createDefaultPmOddsDropSettings, normalizePmOddsDropSettings, patchPmOddsDropSettings, readLegacyPmOddsDropSettings } from "./downSettings";

const SETTINGS_KEY = "changmen:pm-odds-drop:settings:v1";

describe("odds drop persisted settings", () => {
  it("repairs legacy limits without rewriting local storage", () => {
    const raw = JSON.stringify({ minReferenceOdds: 3, maxReferenceOdds: 1.5, referenceVenue: "OB", windowMs: 100, thresholdPct: 120, cooldownMs: 600_000 });
    localStorage.setItem(SETTINGS_KEY, raw);
    expect(readLegacyPmOddsDropSettings()).toMatchObject({ minReferenceOdds: 1.5, maxReferenceOdds: 3, windowMs: 500, thresholdPct: 90, cooldownMs: 300_000 });
    expect(localStorage.getItem(SETTINGS_KEY)).toBe(raw);
  });
  it("ignores missing or corrupt legacy data and repairs cleared inputs", () => {
    expect(readLegacyPmOddsDropSettings()).toBeUndefined();
    for (const raw of ["oops", "null", "[]", "true"]) {
      localStorage.setItem(SETTINGS_KEY, raw);
      expect(readLegacyPmOddsDropSettings()).toBeUndefined();
    }
    expect(normalizePmOddsDropSettings({ windowMs: null, cooldownMs: Infinity, thresholdPct: "" })).toEqual(createDefaultPmOddsDropSettings());
    expect(normalizePmOddsDropSettings({ cooldownMs: 0 }).cooldownMs).toBe(0);
  });
  it("moves the opposite odds bound when an edit crosses it", () => {
    const current = { ...createDefaultPmOddsDropSettings(), minReferenceOdds: 2, maxReferenceOdds: 3 };
    expect(patchPmOddsDropSettings(current, { minReferenceOdds: 4 })).toMatchObject({ minReferenceOdds: 4, maxReferenceOdds: 4 });
    expect(patchPmOddsDropSettings(current, { maxReferenceOdds: 1.5 })).toMatchObject({ minReferenceOdds: 1.5, maxReferenceOdds: 1.5 });
  });
});

afterEach(() => {
  localStorage.removeItem(SETTINGS_KEY);
});
