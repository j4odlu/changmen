import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PolymarketMarketIndex } from "@changmen/api-contract";

const state = vi.hoisted(() => ({
  getPlatform: vi.fn(), saveOdds: vi.fn(), refreshOdds: vi.fn(), registerAssets: vi.fn(),
}));
vi.mock("@changmen/client-core/bridge/clientApi", () => ({ getCollectPlatform: state.getPlatform }));
vi.mock("@changmen/client-core/bridge/oddsAccess", () => ({ saveVenueOdds: state.saveOdds, getVenueOddsEntry: () => null }));
vi.mock("@changmen/venue-browser/shared/webBridge", () => ({
  useCollectStore: () => ({ ready: true }), useMatchStore: () => ({ refreshOddsOnBets: state.refreshOdds }),
}));
vi.mock("@changmen/venue-browser/polymarket/marketQuoteHub", () => ({
  onPolymarketMarketHubReady: () => () => {}, onPolymarketMarketQuote: () => () => {},
  registerPolymarketQuoteAssets: state.registerAssets, unregisterPolymarketQuoteConsumer: vi.fn(),
}));
vi.mock("@changmen/venue-browser/polymarket/quotes/pmTokenQuote", () => ({ saveTokenQuote: vi.fn() }));

import { startPolymarketCollector } from "@changmen/venue-browser/polymarket/markets/collect";
import { lookupPmMapOutcomeByToken, replacePmMapOutcomesFromIndex } from "@changmen/venue-browser/polymarket/markets/pmMapOutcomeStore";

const entry = { sourceMatchId: "e", marketId: "m", sourceBetId: "m", map: 2, homeTokenId: "h",
  awayTokenId: "a", homeName: "Home", awayName: "Away", homeOdds: 0, awayOdds: 0, status: "Locked" };
let stop: (() => void) | undefined;
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  stop?.(); stop = undefined;
  vi.clearAllTimers(); vi.useRealTimers(); vi.clearAllMocks(); replacePmMapOutcomesFromIndex(null);
});

it("loads and refreshes outcome-only indexes on a fresh page and clears them when the index disappears", async () => {
  const index: PolymarketMarketIndex = { updatedAt: 1, entries: [], assetIds: [], outcomeEntries: [{
    ...entry, firstSeenAt: 1, mapOutcome: "away", outcomeKind: "official",
  }] };
  state.getPlatform.mockResolvedValue({ MarketIndex: index });
  stop = startPolymarketCollector();
  await vi.advanceTimersByTimeAsync(0);
  expect(lookupPmMapOutcomeByToken("h")?.winningTokenId).toBe("a");
  index.updatedAt++;
  index.outcomeEntries![0]!.mapOutcome = "home";
  await vi.advanceTimersByTimeAsync(30_000);
  expect(lookupPmMapOutcomeByToken("a")?.winningTokenId).toBe("h");
  index.outcomeEntries = [];
  await vi.advanceTimersByTimeAsync(30_000);
  expect(lookupPmMapOutcomeByToken("h")).toBeNull();
  state.getPlatform.mockResolvedValue({ MarketIndex: null });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(lookupPmMapOutcomeByToken("h")).toBeNull();
  expect(state.registerAssets.mock.calls.every(([, assets]) => assets.length === 0)).toBe(true);
  expect(state.saveOdds).not.toHaveBeenCalled();
  expect(state.refreshOdds).not.toHaveBeenCalled();
});

it("unsubscribes live assets while preserving archived WIN when the last live market disappears", async () => {
  state.getPlatform.mockResolvedValue({ MarketIndex: { updatedAt: 1, entries: [entry], assetIds: ["h", "a"] } });
  stop = startPolymarketCollector();
  await vi.advanceTimersByTimeAsync(0);
  expect(state.registerAssets).toHaveBeenLastCalledWith("esport", ["h", "a"], false);
  state.getPlatform.mockResolvedValue({ MarketIndex: { updatedAt: 2, entries: [], assetIds: [], outcomeEntries: [{
    ...entry, firstSeenAt: 1, mapOutcome: "away", outcomeKind: "official",
  }] } });
  state.saveOdds.mockClear(); state.refreshOdds.mockClear();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(state.registerAssets).toHaveBeenLastCalledWith("esport", [], false);
  expect(lookupPmMapOutcomeByToken("h")?.winningTokenId).toBe("a");
  expect(state.saveOdds).not.toHaveBeenCalled();
  expect(state.refreshOdds).not.toHaveBeenCalled();
  state.getPlatform.mockResolvedValue({ MarketIndex: null });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(lookupPmMapOutcomeByToken("h")).toBeNull();
});
