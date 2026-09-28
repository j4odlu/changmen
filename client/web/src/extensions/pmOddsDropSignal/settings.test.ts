import { afterAll, describe, expect, it, vi } from "vitest";

const SETTINGS_KEY = "changmen:pm-odds-drop:settings:v1";

vi.mock("@changmen/venue-adapter/polymarket", () => ({
  getPmMarketWsSourceMode: () => "official",
  onPolymarketMarketQuote: () => () => {},
}));

localStorage.setItem(SETTINGS_KEY, JSON.stringify({
  enabled: false,
  minReferenceOdds: 3,
  maxReferenceOdds: 1.5,
  referenceVenue: "OB",
  windowMs: 100,
  thresholdPct: 120,
  cooldownMs: 600_000,
}));

const { pmOddsDropSettings } = await import("./runtime");

describe("odds drop persisted settings", () => {
  it("repairs a reversed reference-odds range during startup", () => {
    expect(pmOddsDropSettings.value.minReferenceOdds).toBe(1.5);
    expect(pmOddsDropSettings.value.maxReferenceOdds).toBe(3);
    expect(pmOddsDropSettings.value.windowMs).toBe(500);
    expect(pmOddsDropSettings.value.thresholdPct).toBe(90);
    expect(pmOddsDropSettings.value.cooldownMs).toBe(300_000);
  });
});

afterAll(() => {
  localStorage.removeItem(SETTINGS_KEY);
});
