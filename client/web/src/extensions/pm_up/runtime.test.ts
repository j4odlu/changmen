import type { ViewMatch } from "@/models/match";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { indexPmUpMarkets, snapshotPmUpMarket } from "./markets";
import { createDefaultPmUpPrefs } from "./settings";

const hub = vi.hoisted(() => ({ listener: null as ((quote: { assetId: string; bestAsk: number }) => void) | null, subscribe: vi.fn(), unsubscribe: vi.fn() }));
vi.mock("@changmen/venue-browser/adapter/polymarket", () => ({
  onPolymarketMarketQuote: (listener: typeof hub.listener) => {
    hub.subscribe(); hub.listener = listener;
    return () => { hub.listener = null; hub.unsubscribe(); };
  },
}));
const { startPmUpMonitor, pmUpSignals, clearPmUpSignals } = await import("./runtime");

function fixture() {
  const prices = { obHome: 3, obAway: 2, rayHome: 2.2, rayAway: 0 };
  const items = [
    { type: "Polymarket", homeId: "pm-a", awayId: "pm-b", sourceStatus: "Normal" },
    { type: "OB", homeId: "ob-a", awayId: "ob-b", sourceStatus: "Normal", getOdds: (side: string) => side === "Home" ? prices.obHome : prices.obAway },
    { type: "RAY", homeId: "ray-a", awayId: "ray-b", sourceStatus: "Normal", getOdds: (side: string) => side === "Home" ? prices.rayHome : prices.rayAway },
  ];
  const matches = [{ id: 11, title: "Alpha vs Beta", bets: [{ id: 101, homeName: "Alpha", awayName: "Beta", getBetName: () => "地图1 获胜", items }] }] as unknown as ViewMatch[];
  return { prices, matches, items };
}

let stop: (() => void) | undefined;
const prefs = { ...createDefaultPmUpPrefs(), enabled: true };
function emit(assetId: string, odds: number) { hub.listener?.({ assetId, bestAsk: 1 / odds }); }

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000); vi.clearAllMocks(); clearPmUpSignals(); });
afterEach(() => { stop?.(); stop = undefined; vi.useRealTimers(); });

describe("pm_up local quote monitoring", () => {
  it("does no work when disabled and unsubscribes/cancels queued work on stop", async () => {
    startPmUpMonitor(createDefaultPmUpPrefs(), () => [] )();
    expect(hub.subscribe).not.toHaveBeenCalled();
    const { matches } = fixture();
    stop = startPmUpMonitor(prefs, () => matches);
    emit("pm-a", 1.8); emit("pm-a", 2.2);
    stop(); stop = undefined;
    await vi.runAllTimersAsync();
    expect(hub.unsubscribe).toHaveBeenCalledOnce();
    expect(pmUpSignals.value).toEqual([]);
  });

  it("maps both PM sides to the opposite canonical side in the same market", () => {
    const { matches } = fixture();
    const index = indexPmUpMarkets(matches);
    expect(snapshotPmUpMarket(index.get("pm-a")![0], "pm-a")).toMatchObject({ targetSide: "Away", targetSideLabel: "Beta", targets: [{ provider: "OB", odds: 2 }] });
    expect(snapshotPmUpMarket(index.get("pm-b")![0], "pm-b")).toMatchObject({ targetSide: "Home", targets: [{ provider: "OB", odds: 3 }, { provider: "RAY", odds: 2.2 }] });
  });

  it("snapshots the venue price at receipt, ignores unrelated assets and does not re-emit unchanged quotes", async () => {
    const { matches, prices } = fixture();
    stop = startPmUpMonitor(prefs, () => matches);
    emit("other-market", 1.5);
    emit("pm-a", 1.8);
    vi.setSystemTime(2_000);
    emit("pm-a", 2.2);
    prices.obAway = 1.5;
    await vi.runAllTimersAsync();
    expect(pmUpSignals.value).toHaveLength(1);
    expect(pmUpSignals.value[0]).toMatchObject({ targetSide: "Away", target: { provider: "OB", itemId: "ob-b", odds: 2 } });
    vi.setSystemTime(20_000);
    emit("pm-a", 2.2);
    await vi.runAllTimersAsync();
    expect(pmUpSignals.value).toHaveLength(1);
  });

  it("excludes closed venue sources and resets a closed PM market baseline", async () => {
    const { matches, items } = fixture();
    items[1].sourceStatus = "Lock";
    const location = indexPmUpMarkets(matches).get("pm-a")![0];
    expect(snapshotPmUpMarket(location, "pm-a")?.targets).toEqual([]);
    items[1].sourceStatus = "Normal";
    stop = startPmUpMonitor(prefs, () => matches);
    emit("pm-a", 1.8); await vi.runAllTimersAsync();
    items[0].sourceStatus = "Lock";
    emit("pm-a", 2); await vi.runAllTimersAsync();
    items[0].sourceStatus = "Normal";
    emit("pm-a", 2.2); await vi.runAllTimersAsync();
    expect(pmUpSignals.value).toEqual([]);
  });

  it("drops pending removed markets and rebuilds the token index on match refresh", async () => {
    let { matches } = fixture();
    stop = startPmUpMonitor(prefs, () => matches);
    emit("pm-a", 1.8); emit("pm-a", 2.2);
    matches = [];
    emit("pm-a", 2.3); await vi.runAllTimersAsync();
    expect(pmUpSignals.value).toEqual([]);
    matches = fixture().matches;
    emit("pm-a", 2.3); await vi.runAllTimersAsync();
    expect(pmUpSignals.value).toEqual([]);
    emit("pm-a", 2.4); await vi.runAllTimersAsync();
    expect(pmUpSignals.value).toHaveLength(1);
  });
});
