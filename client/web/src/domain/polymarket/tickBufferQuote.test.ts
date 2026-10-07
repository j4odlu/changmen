import { afterEach, beforeEach, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { BetOption } from "@changmen/client-core/models/betOption";
import { BetOption as BetOptionClass } from "@changmen/client-core/models/betOption";
import { createDefaultExtensionPrefs, normalizeExtensionPrefs, serializeExtensionPrefsForSave } from "@/types/extensionPrefs";
import { useOddsStore } from "@/stores/oddsStore";
import { ViewBet, type ViewMatch } from "@/models/match";
import type { BetRowDto } from "@/types/esport";
import { buildOrderOptions } from "@/domain/betting/buildOrderOptions";
import { createDefaultUserConfig } from "@/types/userConfig";
import { capturePmTickBufferQuote } from "./tickBufferQuote";
import { attachPolymarketDetectionQuote } from "./attachDetectionQuote";
import { clearPmTickBufferMetadata, notePmTickBufferBook, setPmArbPriceBufferPrefs,
  resetPmArbPriceBufferPrefsForTests } from "@changmen/venue-adapter/polymarket";

beforeEach(() => { setActivePinia(createPinia()); clearPmTickBufferMetadata(); resetPmArbPriceBufferPrefsForTests(); });
afterEach(() => { clearPmTickBufferMetadata(); resetPmArbPriceBufferPrefsForTests(); });
function seed(price = 0.5) {
  useOddsStore().save("Polymarket", { id: "t", clobPrice: price, odds: 1 / price, isLock: false, time: Date.now() });
}
function option(odds = 1.960): BetOption { return { type: "Polymarket", itemId: "t", odds, data: null } as BetOption; }
it("old, explicit percent and unknown modes preserve the legacy preferences", () => {
  const old = { enabled: true, multiplier: 1.03 };
  for (const mode of [undefined, "percent", "unknown"]) {
    expect(normalizeExtensionPrefs({ pmArbPriceBuffer: { ...old, mode } }).pmArbPriceBuffer).toEqual(old);
  }
  const prefs = createDefaultExtensionPrefs();
  prefs.pmArbPriceBuffer = { ...old, mode: "tick" };
  expect(JSON.parse(serializeExtensionPrefsForSave(prefs)).pmArbPriceBuffer).toEqual({ ...old, mode: "tick" });
});
it("display and detection cap share the build-time quote, despite a later ask change", () => {
  setPmArbPriceBufferPrefs({ enabled: true, multiplier: 1.01, mode: "tick" });
  notePmTickBufferBook("t", { asset_id: "t", tick_size: "0.01" }); seed();
  expect(useOddsStore().getOdds("Polymarket", "t")).toBe(1.960);
  const leg = option(); capturePmTickBufferQuote(leg);
  seed(0.51); attachPolymarketDetectionQuote(leg);
  expect(leg.data).toMatchObject({ detectionOdds: 1.960, detectionMaxPrice: 0.51, pmBufferMode: "tick" });
  expect(useOddsStore().getOdds("Polymarket", "t")).toBe(1.923);
});
it("tick mode blocks raw-odds and no-fo fallback", () => {
  setPmArbPriceBufferPrefs({ enabled: true, multiplier: 1.01, mode: "tick" }); seed();
  expect(useOddsStore().getOdds("Polymarket", "missing", 2)).toBe(0);
  expect(useOddsStore().getOdds("Polymarket", "t")).toBe(0);
  expect(() => attachPolymarketDetectionQuote(option())).toThrow();
});
it("the separate sport board and POD quote path is unaffected by the esports tick setting", () => {
  setPmArbPriceBufferPrefs({ enabled: true, multiplier: 1.01, mode: "tick" });
  const sportLeg = new BetOptionClass("Polymarket", "sport-match", "condition", "sport-token", 100, "Home", 2);
  expect(() => attachPolymarketDetectionQuote(sportLeg, "sport")).not.toThrow();
  expect(sportLeg.odds).toBe(2);
  expect(sportLeg.data).toBeNull();
});
it("a rejected tick quote clears data so the orchestration cannot mistake it for a successful precheck", () => {
  setPmArbPriceBufferPrefs({ enabled: true, multiplier: 1.01, mode: "tick" });
  notePmTickBufferBook("t", { asset_id: "t", tick_size: "0.01" }); seed();
  const leg = option(); capturePmTickBufferQuote(leg);
  leg.data!.pmTickQuote = { ...(leg.data!.pmTickQuote as object), cap: 0.52 };
  expect(() => attachPolymarketDetectionQuote(leg)).toThrow();
  expect(leg.data).toBeNull();
});
it("percentage data, fallback and cap are unchanged even with quote tick metadata", () => {
  for (const mode of [undefined, "percent"] as const) {
    setPmArbPriceBufferPrefs({ enabled: true, multiplier: 1.01, mode }); seed();
    notePmTickBufferBook("t", { asset_id: "t", tick_size: "0.001" });
    expect(useOddsStore().getOdds("Polymarket", "t")).toBe(1.980);
    expect(useOddsStore().getOdds("Polymarket", "missing", 2)).toBe(2);
    const leg = option(1.980); capturePmTickBufferQuote(leg);
    expect(leg.data).toBeNull();
    attachPolymarketDetectionQuote(leg);
    expect(leg.data).toEqual({ detectionClobPrice: 0.505, detectionMaxPrice: 0.505 });
  }
});
it("changing the setting does not convert an already built percentage attempt to ticks", () => {
  setPmArbPriceBufferPrefs({ enabled: true, multiplier: 1.01 }); seed();
  const leg = option(1.980); capturePmTickBufferQuote(leg);
  setPmArbPriceBufferPrefs({ enabled: true, multiplier: 1.01, mode: "tick" });
  attachPolymarketDetectionQuote(leg);
  expect(leg.data).toEqual({ detectionClobPrice: 0.505, detectionMaxPrice: 0.505 });
});
it("real arbitrage leg construction sizes both legs using the displayed buffered odds", () => {
  const fo = useOddsStore();
  seed();
  fo.save("Polymarket", { id: "a", odds: 1.25, clobPrice: 0.8, isLock: false, time: Date.now() });
  for (const [id, odds] of [["ph", 1.5], ["pa", 2.1]] as const)
    fo.save("PB", { id, odds, isLock: false, time: Date.now() });
  for (const id of ["t", "a"]) notePmTickBufferBook(id, { asset_id: id, tick_size: "0.01" });
  const bet = new ViewBet({ ID: 1, MatchID: 100, HomeID: 1, AwayID: 2, HomeName: "A", AwayName: "B", Name: "", Map: 0,
    Sources: {
      Polymarket: { Type: "Polymarket", BetID: "pm", HomeID: "t", AwayID: "a", HomeOdds: 2, AwayOdds: 1.25 },
      PB: { Type: "PB", BetID: "pb", HomeID: "ph", AwayID: "pa", HomeOdds: 1.5, AwayOdds: 2.1 },
    } } as BetRowDto, { Polymarket: "pm", PB: "pb" }, 0, 0);
  const config = createDefaultUserConfig(); config.profit = 1; config.maxProfit = 2; config.minOdds = 1.01; config.betSorting = "Parallel";
  const match = { id: 100, game: "英雄联盟" } as ViewMatch;
  setPmArbPriceBufferPrefs({ enabled: true, multiplier: 1.01, mode: "tick" });
  const tick = buildOrderOptions(bet, match, config, [], ["Polymarket", "PB"])!;
  expect(tick).toHaveLength(2);
  expect(tick[0]).toMatchObject({ type: "Polymarket", odds: 1.960, betMoney: 100, data: { detectionMaxPrice: 0.51 } });
  expect(tick[1]).toMatchObject({ type: "PB", odds: 2.1, betMoney: 93.33 });
  const percentRuns = [undefined, "percent"] as const;
  for (const mode of percentRuns) {
    setPmArbPriceBufferPrefs({ enabled: true, multiplier: 1.01, mode });
    const percent = buildOrderOptions(bet, match, config, [], ["Polymarket", "PB"])!;
    expect(percent[0]).toMatchObject({ type: "Polymarket", odds: 1.980, betMoney: 100, data: null });
    expect(percent[1]).toMatchObject({ type: "PB", odds: 2.1, betMoney: 94.29 });
  }
});
