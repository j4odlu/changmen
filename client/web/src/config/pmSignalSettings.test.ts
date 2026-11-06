import { afterEach, expect, it, vi } from "vitest";
import {
  createDefaultPmOddsDropSettings, createDefaultPmUpPrefs, isReferenceOddsInSignalRange,
  normalizePmOddsDropSettings, normalizePmUpPrefs, patchPmOddsDropSettings,
} from "./pmSignalSettings";

afterEach(() => { vi.unstubAllGlobals(); });

it("preserves the saved settings keys and defaults for both signal directions", () => {
  expect(createDefaultPmUpPrefs()).toEqual({ enabled: false, minRisePct: 0, minArbPct: 1, windowMs: 5_000, cooldownMs: 10_000 });
  expect(createDefaultPmOddsDropSettings()).toEqual({ enabled: false, windowMs: 5_000, thresholdPct: 5,
    cooldownMs: 10_000, minReferenceOdds: 1.01, maxReferenceOdds: 100, referenceVenue: "Polymarket" });
  const saved = { pmUp: { ...createDefaultPmUpPrefs(), enabled: true, minRisePct: 2 },
    pmDown: { ...createDefaultPmOddsDropSettings(), enabled: true, referenceVenue: "RAY", cooldownMs: 0 } };
  const stored = JSON.parse(JSON.stringify(saved));
  expect({ pmUp: normalizePmUpPrefs(stored.pmUp), pmDown: normalizePmOddsDropSettings(stored.pmDown) }).toEqual(saved);
});

it("preserves the distinct legacy input coercion rules", () => {
  expect(normalizePmUpPrefs({ enabled: "true", minRisePct: "2", minArbPct: NaN, windowMs: "900", cooldownMs: 0 }))
    .toEqual({ ...createDefaultPmUpPrefs(), cooldownMs: 0 });
  expect(normalizePmOddsDropSettings({ enabled: "true", windowMs: "900", thresholdPct: "2", cooldownMs: "0" }))
    .toEqual({ ...createDefaultPmOddsDropSettings(), windowMs: 900, thresholdPct: 2, cooldownMs: 0 });
  for (const raw of [undefined, null, [], true, "bad"]) {
    expect(normalizePmUpPrefs(raw)).toEqual(createDefaultPmUpPrefs());
    expect(normalizePmOddsDropSettings(raw)).toEqual(createDefaultPmOddsDropSettings());
  }
});

it("preserves clamping and repairs saved odds ranges without modifying the input", () => {
  const raw = Object.freeze({ enabled: true, referenceVenue: "OB", minReferenceOdds: 8, maxReferenceOdds: 2,
    windowMs: 100, thresholdPct: 120, cooldownMs: 600_000 });
  expect(normalizePmOddsDropSettings(raw)).toEqual({ enabled: true, referenceVenue: "OB", minReferenceOdds: 2,
    maxReferenceOdds: 8, windowMs: 500, thresholdPct: 90, cooldownMs: 300_000 });
  expect(raw.minReferenceOdds).toBe(8);
  expect(normalizePmUpPrefs({ minRisePct: -1, minArbPct: 200, windowMs: 80_000, cooldownMs: -1 }))
    .toEqual({ enabled: false, minRisePct: 0, minArbPct: 100, windowMs: 60_000, cooldownMs: 0 });
});

it("keeps edited range bounds coherent and signal-range endpoints inclusive", () => {
  const settings = Object.freeze({ ...createDefaultPmOddsDropSettings(), minReferenceOdds: 2, maxReferenceOdds: 3 });
  expect(patchPmOddsDropSettings(settings, Object.freeze({ minReferenceOdds: 4 })))
    .toMatchObject({ minReferenceOdds: 4, maxReferenceOdds: 4 });
  expect(patchPmOddsDropSettings(settings, Object.freeze({ maxReferenceOdds: 1.5 })))
    .toMatchObject({ minReferenceOdds: 1.5, maxReferenceOdds: 1.5 });
  expect(isReferenceOddsInSignalRange(2, settings)).toBe(true);
  expect(isReferenceOddsInSignalRange(3, settings)).toBe(true);
  for (const odds of [1.99, 3.01, Infinity, NaN]) expect(isReferenceOddsInSignalRange(odds, settings)).toBe(false);
  expect(settings).toMatchObject({ minReferenceOdds: 2, maxReferenceOdds: 3 });
});

it("loads and normalizes preferences without browser storage, network or DOM access", async () => {
  const unavailable = new Proxy({}, { get() { throw Error("Pure settings accessed browser state"); } });
  vi.stubGlobal("window", unavailable);
  vi.stubGlobal("document", unavailable);
  vi.stubGlobal("localStorage", unavailable);
  vi.stubGlobal("fetch", () => { throw Error("Pure settings accessed network"); });
  vi.resetModules();
  const settings = await import("./pmSignalSettings");
  expect(settings.normalizePmUpPrefs({ enabled: true }).enabled).toBe(true);
  expect(settings.normalizePmOddsDropSettings({ referenceVenue: "PB" }).referenceVenue).toBe("PB");
  expect(settings.patchPmOddsDropSettings(settings.createDefaultPmOddsDropSettings(), { cooldownMs: 0 }).cooldownMs).toBe(0);
});
