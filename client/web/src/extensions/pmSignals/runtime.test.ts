import type { ViewMatch } from "@/models/match";
import type { PmSignalMonitorSettings } from "./runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";
import { createDefaultPmUpPrefs } from "./upSettings";
import { pmOddsDropSignals, pmUpSignals } from "./records";
import { createDefaultPmOddsDropSettings } from "./downSettings";
import { clearAllSignals } from "./state";
import { startPmSignalMonitor } from "./runtime";

type Quote = { assetId: string; bestAsk: number };
const hub = vi.hoisted(() => ({ listener: null as ((quote: Quote) => void) | null, subscribe: vi.fn(), unsubscribe: vi.fn() }));
vi.mock("@changmen/venue-browser/adapter/polymarket", () => ({
  onPolymarketMarketQuote: (listener: (quote: Quote) => void) => {
    hub.subscribe(); hub.listener = listener;
    return () => { hub.listener = null; hub.unsubscribe(); };
  },
  getPmMarketWsSourceMode: () => "official",
}));

function fixture() {
  const prices = { home: 2, away: 2, fail: false };
  const matches = [{ id: 11, title: "Alpha vs Beta", bets: [{
    id: 101, homeName: "Alpha", awayName: "Beta", getBetName: () => "地图1",
    items: [
      { type: "Polymarket", homeId: "pm-a", awayId: "pm-b", sourceStatus: "Normal", getOdds: () => 2 },
      { type: "OB", homeId: "ob-a", awayId: "ob-b", sourceStatus: "Normal", getOdds: (side: string) => {
        if (prices.fail) throw new Error("quote unavailable");
        return side === "Home" ? prices.home : prices.away;
      } },
    ],
  }] }] as unknown as ViewMatch[];
  const settings = reactive<PmSignalMonitorSettings>({
    down: { ...createDefaultPmOddsDropSettings(), enabled: true, referenceVenue: "Polymarket", minReferenceOdds: 1.01, maxReferenceOdds: 100, thresholdPct: 5, windowMs: 5000, cooldownMs: 10_000 },
    up: { ...createDefaultPmUpPrefs(), enabled: true },
  });
  return { prices, matches, settings };
}

let stop: (() => void) | undefined;
const emit = (odds: number, assetId = "pm-a") => hub.listener?.({ assetId, bestAsk: 1 / odds });
const drain = () => vi.advanceTimersByTimeAsync(1);
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1000); vi.clearAllMocks(); clearAllSignals(); });
afterEach(() => { stop?.(); stop = undefined; clearAllSignals(); vi.useRealTimers(); });

describe("one PM signal monitor", () => {
  it("uses one listener and one drain for both enabled branches without a PM polling timer", async () => {
    const { settings, matches } = fixture();
    stop = startPmSignalMonitor(() => settings, () => matches);
    expect(hub.subscribe).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    emit(2); emit(2.4); emit(2);
    expect(vi.getTimerCount()).toBe(1);
    expect(pmUpSignals.value).toEqual([]);
    expect(pmOddsDropSignals.value).toEqual([]);
    await drain();
    expect(pmUpSignals.value).toHaveLength(1);
    expect(pmOddsDropSignals.value).toHaveLength(1);
    expect(pmUpSignals.value[0]).toMatchObject({ beforeOdds: 2, pmOdds: 2.4, targetSide: "Away" });
    expect(pmOddsDropSignals.value[0]).toMatchObject({ beforeOdds: 2.4, currentOdds: 2, venueSnapshot: { side: "Home" } });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("drops old up tasks after a settings change while retaining queued down samples and its baseline", async () => {
    const { settings, matches } = fixture();
    stop = startPmSignalMonitor(() => settings, () => matches);
    emit(2); await drain();
    emit(2.4);
    settings.up.minArbPct = 100;
    await drain();
    emit(2); await drain();
    expect(pmUpSignals.value).toEqual([]);
    expect(pmOddsDropSignals.value[0]?.beforeOdds).toBe(2.4);
    expect(hub.subscribe).toHaveBeenCalledTimes(1);
    expect(hub.unsubscribe).not.toHaveBeenCalled();
  });

  it("keeps the up baseline and cooldown when down is disabled or its reference venue changes", async () => {
    const { settings, matches } = fixture();
    const readReferenceQuotes = vi.fn(() => []);
    stop = startPmSignalMonitor(() => settings, () => matches, { readReferenceQuotes });
    emit(1.8); await drain();
    settings.down.enabled = false;
    emit(2.2); await drain();
    expect(pmUpSignals.value).toHaveLength(1);
    settings.down.referenceVenue = "OB";
    settings.down.enabled = true;
    emit(2.3); await drain();
    expect(pmUpSignals.value).toHaveLength(1);
    expect(pmOddsDropSignals.value).toEqual([]);
    await vi.advanceTimersByTimeAsync(101);
    expect(readReferenceQuotes).toHaveBeenCalledWith("OB");
    expect(hub.subscribe).toHaveBeenCalledTimes(1);
  });

  it("freezes the opposite quote at receipt and retains the newest valid match index", async () => {
    const data = fixture();
    let matches = data.matches;
    stop = startPmSignalMonitor(() => data.settings, () => matches);
    emit(1.8); await drain();
    emit(2.2);
    data.prices.away = 1.2;
    await drain();
    expect(pmUpSignals.value[0]?.target.odds).toBe(2);
    clearAllSignals();
    data.prices.away = 2;
    emit(2.3);
    matches = [];
    emit(2.4); await drain();
    expect(pmUpSignals.value).toEqual([]);
  });

  it("freezes same-side comparison prices before an asynchronous down task is drained", async () => {
    const { settings, matches, prices } = fixture();
    stop = startPmSignalMonitor(() => settings, () => matches);
    emit(2.4); await drain();
    prices.home = 2.2;
    emit(2);
    prices.home = 1.1;
    await drain();
    expect(pmOddsDropSignals.value[0]?.venueSnapshot?.ob).toMatchObject({ odds: 2.2, evPercent: 10 });
  });

  it("reindexes reactive token replacements without requiring a new outer match array", async () => {
    const { settings, matches: raw } = fixture();
    const matches = reactive(raw);
    stop = startPmSignalMonitor(() => settings, () => matches);
    emit(1.8); await drain();
    emit(2.2);
    matches[0]!.bets[0]!.items[0]!.homeId = "pm-new";
    emit(2.3, "pm-new"); await drain();
    expect(pmUpSignals.value).toEqual([]);
    emit(2.4, "pm-new"); await drain();
    expect(pmUpSignals.value[0]?.assetId).toBe("pm-new");
  });

  it("continues down detection when an up comparison quote reader fails", async () => {
    const { settings, matches, prices } = fixture();
    stop = startPmSignalMonitor(() => settings, () => matches);
    emit(2.4); await drain();
    prices.fail = true;
    expect(() => emit(2)).not.toThrow();
    await drain();
    expect(pmOddsDropSignals.value).toHaveLength(1);
    expect(pmOddsDropSignals.value[0]?.venueSnapshot).toBeNull();
    expect(pmUpSignals.value).toEqual([]);
  });

  it("only allocates resources for active branches and unsubscribes once when all are off", async () => {
    const { settings, matches } = fixture();
    settings.down.enabled = settings.up.enabled = false;
    stop = startPmSignalMonitor(() => settings, () => matches);
    expect(hub.subscribe).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    settings.down.referenceVenue = "OB";
    settings.down.enabled = true;
    expect(hub.subscribe).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    settings.up.enabled = true;
    expect(hub.subscribe).toHaveBeenCalledTimes(1);
    const staleListener = hub.listener!;
    settings.down.enabled = false;
    expect(vi.getTimerCount()).toBe(0);
    expect(hub.unsubscribe).not.toHaveBeenCalled();
    emit(1.8); emit(2.2);
    settings.up.enabled = false;
    expect(hub.unsubscribe).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    stop(); stop(); stop = undefined;
    staleListener({ assetId: "pm-a", bestAsk: .4 });
    await drain();
    expect(vi.getTimerCount()).toBe(0);
    expect(hub.unsubscribe).toHaveBeenCalledTimes(1);
    expect(pmUpSignals.value).toEqual([]);
  });

  it("resets both branches across shared queue overflow instead of comparing across lost quotes", async () => {
    const { settings, matches } = fixture();
    stop = startPmSignalMonitor(() => settings, () => matches);
    emit(2.4); await drain();
    for (let i = 0; i < 4096; i++) emit(1.8, "unmapped");
    emit(2);
    await drain();
    expect(pmOddsDropSignals.value).toEqual([]);
    expect(pmUpSignals.value).toEqual([]);
  });
});
