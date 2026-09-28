import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let emitPmQuote: ((quote: { assetId: string; bestAsk: number }) => void) | null = null;
let subscribeCalls = 0;

vi.mock("@changmen/venue-adapter/polymarket", () => ({
  getPmMarketWsSourceMode: () => "official",
  onPolymarketMarketQuote: (listener: typeof emitPmQuote) => {
    subscribeCalls += 1;
    emitPmQuote = listener;
    return () => {
      emitPmQuote = null;
    };
  },
}));

const {
  clearPmOddsDropSignals,
  isReferenceOddsInSignalRange,
  pmOddsDropSignals,
  startPmOddsDropSignalMonitor,
  updatePmOddsDropSettings,
} = await import("./runtime");

describe("selectable odds drop reference venue runtime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    clearPmOddsDropSignals();
    subscribeCalls = 0;
    updatePmOddsDropSettings({
      enabled: true,
      minReferenceOdds: 1.01,
      maxReferenceOdds: 100,
      referenceVenue: "OB",
      thresholdPct: 5,
      windowMs: 5_000,
      cooldownMs: 0,
    });
  });

  afterEach(() => {
    updatePmOddsDropSettings({ enabled: false, referenceVenue: "Polymarket" });
    clearPmOddsDropSignals();
    vi.useRealTimers();
  });

  it("does not register listeners or timers while monitoring is disabled", () => {
    updatePmOddsDropSettings({ enabled: false });
    const timersBefore = vi.getTimerCount();
    const stop = startPmOddsDropSignalMonitor(undefined, () => []);

    expect(subscribeCalls).toBe(0);
    expect(vi.getTimerCount()).toBe(timersBefore);
    stop();
  });

  it("filters against the selected reference venue current odds", () => {
    expect(isReferenceOddsInSignalRange(1.8, {
      minReferenceOdds: 1.5,
      maxReferenceOdds: 2,
    })).toBe(true);
    expect(isReferenceOddsInSignalRange(2.1, {
      minReferenceOdds: 1.5,
      maxReferenceOdds: 2,
    })).toBe(false);
  });

  it("detects an OB drop from read-only changed quotes and snapshots its selection", async () => {
    updatePmOddsDropSettings({ minReferenceOdds: 1.7, maxReferenceOdds: 1.9 });
    let obOdds = 2;
    const stop = startPmOddsDropSignalMonitor(
      (_signal, venue) => ({
        matchId: 11,
        matchTitle: "Alpha vs Beta",
        marketTitle: "地图1",
        side: "Home",
        sideLabel: "Alpha",
        referenceVenue: venue,
        pm: null,
        ob: null,
        ray: null,
        pb: null,
      }),
      venue => venue === "OB"
        ? [{
            key: "11:101:Home",
            odds: obOdds,
            selection: { matchId: 11, betId: 101, side: "Home" },
          }]
        : [],
    );

    await vi.advanceTimersByTimeAsync(101);
    expect(pmOddsDropSignals.value).toHaveLength(0);

    // 即使稳定时间超过检测窗口，心跳仍保留“下降前”的最近基线。
    await vi.advanceTimersByTimeAsync(6_000);
    obOdds = 1.8;
    await vi.advanceTimersByTimeAsync(101);

    expect(pmOddsDropSignals.value).toHaveLength(1);
    expect(pmOddsDropSignals.value[0]).toMatchObject({
      referenceVenue: "OB",
      selection: { matchId: 11, betId: 101, side: "Home" },
      beforeOdds: 2,
    });
    expect(pmOddsDropSignals.value[0]?.currentOdds).toBeCloseTo(1.8);
    expect(pmOddsDropSignals.value[0]?.dropPct).toBeCloseTo(10);

    clearPmOddsDropSignals();
    obOdds = 1.6;
    await vi.advanceTimersByTimeAsync(101);
    expect(pmOddsDropSignals.value).toHaveLength(0);

    stop();
    expect(emitPmQuote).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores PM quote events while OB is selected", async () => {
    const stop = startPmOddsDropSignalMonitor(undefined, () => []);
    emitPmQuote?.({ assetId: "pm-token", bestAsk: 0.5 });
    emitPmQuote?.({ assetId: "pm-token", bestAsk: 0.6 });
    await vi.advanceTimersByTimeAsync(1);

    expect(pmOddsDropSignals.value).toHaveLength(0);
    stop();
  });
});
