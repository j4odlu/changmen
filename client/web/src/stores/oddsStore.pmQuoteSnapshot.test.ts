import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { BetOption } from "@changmen/client-core/models/betOption";
import { ViewBetItem } from "@/models/match";
import { capturePmPriceQuote } from "@/domain/polymarket/tickBufferQuote";
import { attachPolymarketDetectionQuote } from "@/domain/polymarket/attachDetectionQuote";
import { clearPmTickBufferMetadata, notePmTickBufferBook, resetPmArbPriceBufferPrefsForTests,
  setPmArbPriceBufferPrefs } from "@changmen/venue-adapter/polymarket";
import { useOddsStore } from "./oddsStore";

beforeEach(() => {
  setActivePinia(createPinia()); vi.useFakeTimers(); vi.setSystemTime(10_000_000);
  clearPmTickBufferMetadata(); resetPmArbPriceBufferPrefsForTests();
});
afterEach(() => { clearPmTickBufferMetadata(); resetPmArbPriceBufferPrefsForTests(); vi.useRealTimers(); });
function seed(id = "home", ask = 0.5, locked = false) {
  useOddsStore().save("Polymarket", { id, odds: 1 / ask, clobPrice: ask, isLock: locked,
    betId: "market", side: "home", time: Date.now() }, "mqtt");
}
function item() {
  return new ViewBetItem({ Type: "Polymarket", BetID: "market", HomeID: "home", AwayID: "away",
    HomeOdds: 0, AwayOdds: 0, Status: "Normal" }, "match");
}
function leg(odds = useOddsStore().getOdds("Polymarket", "home")): BetOption {
  return { type: "Polymarket", itemId: "home", odds, data: null } as BetOption;
}

it.each(["percent", "tick"] as const)("%s display and new legs retain the complete ask through cache rebuilding", mode => {
  setPmArbPriceBufferPrefs({ enabled: true, mode, multiplier: 1.01 });
  notePmTickBufferBook("home", { asset_id: "home", tick_size: "0.01" }); seed();
  const store = useOddsStore(); const raw = { ...store.getEntry("Polymarket", "home")! };
  const view = item(); view.updateOdds(); const displayed = view.getOdds("Home");
  store.clean("Polymarket");
  expect(store.getEntry("Polymarket", "home")).toBeUndefined();
  expect(store.isOdds("Polymarket", "home")).toBe(false);
  expect(store.getPmQuoteEntry("home")).toEqual(raw);
  expect(Object.isFrozen(store.getPmQuoteEntry("home"))).toBe(true);
  expect(view.getOdds("Home")).toBe(displayed);
  const attempt = leg(displayed); attachPolymarketDetectionQuote(attempt);
  expect(attempt.data).toMatchObject({ pmPriceQuote: { mode, rawAsk: 0.5,
    cap: mode === "percent" ? 0.505 : 0.51 }, detectionOdds: displayed });
  store.clean("Polymarket");
  expect(view.getOdds("Home")).toBe(displayed);
  expect(store.getPmQuoteEntry("home")).toEqual(raw);
});

it("configuration changes reconvert the raw snapshot while existing attempts keep their frozen quote", () => {
  setPmArbPriceBufferPrefs({ enabled: true, multiplier: 1.01 }); seed();
  const view = item(); view.updateOdds(); const attempt = leg(); capturePmPriceQuote(attempt);
  useOddsStore().clean("Polymarket");
  setPmArbPriceBufferPrefs({ enabled: true, multiplier: 1.02 });
  expect(view.getOdds("Home")).toBe(1.960);
  expect(leg().odds).toBe(1.960);
  attachPolymarketDetectionQuote(attempt);
  expect(attempt.data).toMatchObject({ pmPriceQuote: { rawAsk: 0.5, cap: 0.505 }, detectionOdds: 1.980 });
  setPmArbPriceBufferPrefs({ enabled: false, multiplier: 1.02 });
  expect(view.getOdds("Home")).toBe(2);
  seed("home", 0.49);
  expect(view.getOdds("Home")).toBe(2.040);
  expect(useOddsStore().getPmQuoteEntry("home")?.clobPrice).toBe(0.49);
});

it("single and market lock updates cover retained and newly received sides together", () => {
  setPmArbPriceBufferPrefs({ enabled: true, multiplier: 1.01 }); seed(); seed("away");
  const store = useOddsStore(); store.clean("Polymarket");
  store.updateOddsLock("Polymarket", "home", true);
  expect(store.getOdds("Polymarket", "home", 1.980)).toBe(0);
  expect(() => attachPolymarketDetectionQuote(leg(1.980))).toThrow();
  seed("away", 0.49); // Only one side has arrived during the new collection round.
  store.updateBetLock("Polymarket", "market", true);
  expect(store.getPmQuoteEntry("home")?.isLock).toBe(true);
  expect(store.getEntry("Polymarket", "away")?.isLock).toBe(true);
  store.clean("Polymarket");
  expect(store.getOdds("Polymarket", "home", 1.980)).toBe(0);
  expect(store.getOdds("Polymarket", "away", 2.020)).toBe(0);
  store.updateBetLock("Polymarket", "market", false);
  expect(store.getOdds("Polymarket", "home")).toBe(1.980);
  expect(store.getOdds("Polymarket", "away")).toBe(2.020);
});

it("new locked or invalid raw data takes priority over an older valid snapshot", () => {
  setPmArbPriceBufferPrefs({ enabled: true, multiplier: 1.01 }); seed();
  const store = useOddsStore(); store.clean("Polymarket"); seed("home", 0.49, true);
  expect(store.getOdds("Polymarket", "home", 1.980)).toBe(0);
  store.save("Polymarket", { id: "home", odds: 0, clobPrice: 0, isLock: false, time: Date.now() });
  expect(store.getOdds("Polymarket", "home", 1.980)).toBe(0);
  expect(() => attachPolymarketDetectionQuote(leg(1.980))).toThrow();
});

it.each(["global", "platform"])("%s cleaning expires retained asks after the original one-hour window", scope => {
  setPmArbPriceBufferPrefs({ enabled: true, multiplier: 1.01 }); seed();
  const store = useOddsStore(); const view = item(); view.updateOdds(); store.clean("Polymarket");
  vi.advanceTimersByTime(3_600_001);
  store.clean(scope === "platform" ? "Polymarket" : undefined);
  expect(store.getPmQuoteEntry("home")).toBeUndefined();
  expect(view.getOdds("Home")).toBe(0); // A previously copied display number must not revive the quote.
  expect(() => attachPolymarketDetectionQuote(leg(1.980))).toThrow();
  store.updateBetLock("Polymarket", "market", false);
  expect(view.getOdds("Home")).toBe(0);
  seed();
  expect(view.getOdds("Home")).toBe(1.980);
  expect(() => attachPolymarketDetectionQuote(leg())).not.toThrow();
});

it("global cleaning also suppresses a stale display number when the expired ask was never snapshotted", () => {
  setPmArbPriceBufferPrefs({ enabled: true, multiplier: 1.01 }); seed();
  const view = item(); view.updateOdds(); vi.advanceTimersByTime(3_600_001);
  useOddsStore().clean();
  expect(view.getOdds("Home")).toBe(0);
});

it("traditional venue clearing retains its original fallback behavior", () => {
  const store = useOddsStore(); store.save("OB", { id: "selection", odds: 1.95, isLock: false, time: Date.now() });
  store.clean("OB");
  expect(store.getEntry("OB", "selection")).toBeUndefined();
  expect(store.getOdds("OB", "selection", 1.95)).toBe(1.95);
  expect(store.pmQuoteSnapshots.size).toBe(0);
});
