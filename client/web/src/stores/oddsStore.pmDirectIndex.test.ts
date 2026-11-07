import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { computed } from "vue";
import { createPinia, setActivePinia } from "pinia";
import type { PolymarketMarketIndex } from "@changmen/api-contract";
import type { BetOption } from "@changmen/client-core/models/betOption";
import { writeVenueOdds } from "@changmen/client-core/bridge/oddsAccess";
import { ViewBetItem } from "@/models/match";
import { installClientCoreBridges, clearClientCoreBridges } from "@/runtime/installClientCore";
import { attachPolymarketDetectionQuote, capturePmPriceQuote } from "@/services/polymarketQuotes";
import { startPolymarketCollector } from "@changmen/venue-browser/polymarket/markets/collect";
import { __testResetPolymarketMarketQuoteHub } from "@changmen/venue-browser/polymarket/marketQuoteHub";
import { resetPmMarketWsSourceModeForTests } from "@changmen/venue-browser/polymarket/pmMarketWsMode";
import { resetOfficialFailStreakForTests, setPmMarketWsSourceModeAndReconnect } from "@changmen/venue-browser/polymarket/ws";
import { resetPmRoutingPreferenceForTests } from "@changmen/venue-browser/polymarket/pmRoutingPreference";
import { saveTokenQuote, syncPolymarketFoOnPriceAboveDetection, PolymarketPriceAboveDetectionError,
  resetPolymarketLiveQuoteTsForTests } from "@changmen/venue-browser/polymarket/quotes/pmTokenQuote";
import { resetPmArbPriceBufferPrefsForTests, setPmArbPriceBufferPrefs } from "@changmen/venue-browser/polymarket/quotes/pmArbPriceBufferMode";
import { notePmTickBufferBook, clearPmTickBufferMetadata } from "@changmen/venue-browser/polymarket/pmTickMetadata";
import { useOddsStore } from "./oddsStore";

const state = vi.hoisted(() => ({ getPlatform: vi.fn(), refresh: vi.fn() }));
vi.mock("@changmen/client-core/bridge/clientApi", async original => ({
  ...await original<typeof import("@changmen/client-core/bridge/clientApi")>(), getCollectPlatform: state.getPlatform,
}));
vi.mock("@changmen/venue-browser/shared/webBridge", () => ({
  useCollectStore: () => ({ ready: true }), useMatchStore: () => ({ refreshOddsOnBets: state.refresh }),
}));
vi.mock("@/services/orderObservation", () => ({ startOrderObservation: vi.fn() }));
vi.mock("@/runtime/pmTickBufferQuotes", () => ({ installPmTickBufferQuotes: vi.fn(), stopPmTickBufferQuotes: vi.fn() }));
vi.mock("@/runtime/pmDynamicWsPreflight", () => ({ installPmDynamicWsPreflight: vi.fn(), stopPmDynamicWsPreflight: vi.fn() }));

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  constructor(public url: string) { Socket.instances.push(this); }
  send(raw: string) {
    this.sent.push(raw);
    if (raw === "PING") this.onmessage?.({ data: "PONG" });
  }
  open() { this.readyState = Socket.OPEN; this.onopen?.(); }
  close() { this.readyState = 3; this.onclose?.(); }
  frame(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
  book(id: string, ask: number) {
    this.frame({ event_type: "book", asset_id: id, timestamp: String(Date.now()),
      bids: [], asks: [{ price: String(ask), size: "10" }] });
  }
  frames() { return this.sent.filter(raw => raw !== "PING").map(raw => JSON.parse(raw)); }
}
const entry = (home = "h", away = "a") => ({ sourceMatchId: "event", marketId: home,
  sourceBetId: home, map: 1, homeTokenId: home, awayTokenId: away,
  homeName: "Home", awayName: "Away", homeOdds: 3.571, awayOdds: 1.388,
  homeClobPrice: 0.28, awayClobPrice: 0.72, status: "Normal" });
let index: PolymarketMarketIndex;
let stop: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal("WebSocket", Socket); Socket.instances = [];
  resetPmMarketWsSourceModeForTests("official"); resetPmRoutingPreferenceForTests(); resetOfficialFailStreakForTests();
  resetPolymarketLiveQuoteTsForTests(); resetPmArbPriceBufferPrefsForTests(); clearPmTickBufferMetadata();
  setActivePinia(createPinia()); installClientCoreBridges();
  index = { updatedAt: 1, entries: [entry()], assetIds: ["h", "a"] };
  state.getPlatform.mockImplementation(async () => ({ MarketIndex: index }));
});
afterEach(() => {
  stop?.(); stop = undefined; __testResetPolymarketMarketQuoteHub(); clearClientCoreBridges();
  resetPolymarketLiveQuoteTsForTests(); resetPmMarketWsSourceModeForTests("changmen");
  resetPmArbPriceBufferPrefsForTests(); clearPmTickBufferMetadata();
  vi.clearAllTimers(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.clearAllMocks();
});
async function start() {
  stop = startPolymarketCollector(); await vi.advanceTimersByTimeAsync(0);
  return Socket.instances.at(-1)!;
}

it("official initialization uses only Index mappings and waits for book, including an independently quoted side", async () => {
  const store = useOddsStore();
  const view = new ViewBetItem({ Type: "Polymarket", BetID: "h", HomeID: "h", AwayID: "a",
    HomeOdds: 3.571, AwayOdds: 1.388 }, "event");
  view.fallbackHomeOdds = 3.571; // A previously copied number must not act as live price.
  const socket = await start();
  expect(store.getEntry("Polymarket", "h")).toBeUndefined();
  expect(view.getOdds("Home")).toBe(0);
  expect(store.isQuotePending("Polymarket", "h")).toBe(true);
  socket.open(); socket.book("h", 0.35);
  expect(socket.frames()[0].assets_ids).toEqual(["h", "a"]);
  expect(store.getPmQuoteEntry("h")).toMatchObject({ clobPrice: 0.35, pmQuoteSource: "ws", isLock: false });
  expect(view.getOdds("Home")).toBe(2.857);
  expect(store.getOdds("Polymarket", "a", 1.388)).toBe(0);
  expect(store.isQuotePending("Polymarket", "h")).toBe(false);
  expect(state.refresh).not.toHaveBeenCalled();
});

it.each([false, true])("Index refresh cannot overwrite HTTP book correction (clean=%s)", async clean => {
  const socket = await start(); socket.open(); socket.book("h", 0.28);
  const store = useOddsStore();
  syncPolymarketFoOnPriceAboveDetection({ itemId: "h", betId: "h", target: "Home" } as BetOption,
    new PolymarketPriceAboveDetectionError("higher ask", 0.35, 0.29));
  expect(store.getPmQuoteEntry("h")).toMatchObject({ clobPrice: 0.35, source: "http", pmQuoteSource: "book-correct" });
  if (clean) store.clean("Polymarket");
  index.updatedAt++;
  await vi.advanceTimersByTimeAsync(30_000);
  expect(store.getPmQuoteEntry("h")?.clobPrice).toBe(0.35);
  expect(store.getOdds("Polymarket", "h", 3.571)).toBe(2.857);
  socket.book("h", 0.34);
  expect(store.getPmQuoteEntry("h")?.clobPrice).toBe(0.34);
  expect(store.getOdds("Polymarket", "h")).toBe(2.941);
});

it("new assets wait for their own book and reconnect restores the current union without Index prices", async () => {
  const socket = await start(); socket.open(); socket.book("h", 0.35);
  index.entries.push(entry("new-h", "new-a")); index.assetIds.push("new-h", "new-a"); index.updatedAt++;
  await vi.advanceTimersByTimeAsync(30_000);
  expect(socket.frames().at(-1)).toMatchObject({ operation: "subscribe", assets_ids: ["new-h", "new-a"] });
  const store = useOddsStore();
  expect(store.getOdds("Polymarket", "new-h", 3.571)).toBe(0);
  socket.book("new-h", 0.4);
  expect(store.getOdds("Polymarket", "new-h")).toBe(2.5);
  socket.close(); await vi.advanceTimersByTimeAsync(5_000);
  const next = Socket.instances.at(-1)!; next.open(); next.book("new-h", 0.41);
  expect(next.frames()[0].assets_ids).toEqual(["h", "a", "new-h", "new-a"]);
  expect(store.getPmQuoteEntry("new-h")?.clobPrice).toBe(0.41);
});

it.each([false, true])("switching relay to official immediately hides seed entries and fallback (clean=%s)", async clean => {
  setPmMarketWsSourceModeAndReconnect("changmen");
  const socket = await start(); socket.open();
  const store = useOddsStore();
  expect(store.getEntry("Polymarket", "h")).toMatchObject({ clobPrice: 0.28, pmQuoteSource: "http-seed" });
  // An odds-only write must not strip the seed identity, even after cache rebuilding.
  if (clean) store.clean("Polymarket");
  writeVenueOdds("Polymarket", { id: "h", odds: 3.571, betId: "h" });
  const displayed = computed(() => store.getOdds("Polymarket", "h", 3.571));
  expect(displayed.value).toBe(3.571);
  setPmMarketWsSourceModeAndReconnect("official");
  expect(displayed.value).toBe(0);
  expect(store.getEntry("Polymarket", "h")).toBeUndefined();
  expect(store.getPmQuoteEntry("h")).toBeUndefined();
  const official = Socket.instances.at(-1)!; official.open(); official.book("h", 0.35);
  expect(displayed.value).toBe(2.857);
  expect(store.getPmQuoteEntry("h")?.pmQuoteSource).toBe("ws");
});

it.each([false, true])("an untouched relay seed snapshot is not reused on official (clean=%s)", clean => {
  setPmMarketWsSourceModeAndReconnect("changmen");
  const store = useOddsStore();
  saveTokenQuote({ tokenId: "h", clobPrice: 0.28, betId: "h", side: "home", locked: false }, "http");
  if (clean) store.clean("Polymarket");
  setPmMarketWsSourceModeAndReconnect("official");
  expect(store.getPmQuoteEntry("h")).toBeUndefined();
  expect(store.getOdds("Polymarket", "h", 3.571)).toBe(0);
  saveTokenQuote({ tokenId: "h", clobPrice: 0.28, betId: "h", side: "home", locked: false }, "http");
  expect(store.getPmQuoteEntry("h")).toBeUndefined();
});

it.each(["percent", "tick"] as const)("%s quotes and existing frozen attempts retain their original cap", async mode => {
  setPmArbPriceBufferPrefs({ enabled: true, mode, multiplier: 1.01 });
  notePmTickBufferBook("h", { asset_id: "h", tick_size: "0.01" });
  const socket = await start(); socket.open(); socket.book("h", 0.35);
  const store = useOddsStore();
  const option = { type: "Polymarket", itemId: "h", odds: store.getOdds("Polymarket", "h"), data: null } as BetOption;
  capturePmPriceQuote(option);
  const frozen = JSON.stringify(option.data);
  index.updatedAt++; await vi.advanceTimersByTimeAsync(30_000);
  socket.book("h", 0.34); attachPolymarketDetectionQuote(option);
  expect(JSON.stringify(option.data)).toBe(frozen);
  expect(option.data?.pmPriceQuote).toMatchObject({ rawAsk: 0.35, cap: mode === "tick" ? 0.36 : 0.3535 });
});

it("official no-price policy leaves other venues and independent sport fallback unchanged", () => {
  const store = useOddsStore();
  expect(store.getOdds("OB", "missing", 1.95)).toBe(1.95);
  expect(store.getOdds("Polymarket", "sport-token", 2, "sport")).toBe(2);
  expect(store.isQuotePending("Polymarket", "sport-token", "sport")).toBe(false);
  setPmMarketWsSourceModeAndReconnect("changmen");
  expect(store.getOdds("Polymarket", "missing", 2)).toBe(2);
});

it("old unmarked HTTP entries cannot revive a seed after a hot update, while marked HTTP corrections remain usable", () => {
  const store = useOddsStore();
  store.save("Polymarket", { id: "h", clobPrice: 0.28, odds: 3.571, isLock: false, time: Date.now() }, "http");
  expect(store.getEntry("Polymarket", "h")).toBeUndefined();
  store.clean("Polymarket");
  expect(store.getPmQuoteEntry("h")).toBeUndefined();
  expect(store.getOdds("Polymarket", "h", 3.571)).toBe(0);
  syncPolymarketFoOnPriceAboveDetection({ itemId: "h", betId: "h", target: "Home" } as BetOption,
    new PolymarketPriceAboveDetectionError("higher ask", 0.35, 0.29));
  expect(store.getPmQuoteEntry("h")).toMatchObject({ clobPrice: 0.35, source: "http", pmQuoteSource: "book-correct" });
});

it("relay odds-only initialization is marked and becomes unavailable on switching to official", async () => {
  setPmMarketWsSourceModeAndReconnect("changmen");
  delete index.entries[0]!.homeClobPrice;
  delete index.entries[0]!.awayClobPrice;
  const socket = await start(); socket.open();
  const store = useOddsStore();
  expect(store.getPmQuoteEntry("h")).toMatchObject({ odds: 3.571, pmQuoteSource: "http-seed" });
  store.clean("Polymarket");
  setPmMarketWsSourceModeAndReconnect("official");
  expect(store.getOdds("Polymarket", "h", 3.571)).toBe(0);
  expect(store.getPmQuoteEntry("h")).toBeUndefined();
});

it("bridge teardown releases the routing mirror and reinstallation syncs the latest mode", () => {
  const store = useOddsStore();
  clearClientCoreBridges(); setPmMarketWsSourceModeAndReconnect("changmen");
  expect(store.pmMarketWsSourceMode).toBe("official");
  installClientCoreBridges();
  expect(store.pmMarketWsSourceMode).toBe("changmen");
  setPmMarketWsSourceModeAndReconnect("official");
  expect(store.pmMarketWsSourceMode).toBe("official");
  store.$reset(); expect(store.pmMarketWsSourceMode).toBe("official");
});

it("switching official to relay immediately initializes from the unchanged Index only once", async () => {
  const socket = await start(); socket.open();
  const store = useOddsStore();
  expect(store.getPmQuoteEntry("h")).toBeUndefined();
  setPmMarketWsSourceModeAndReconnect("changmen");
  const relay = Socket.instances.at(-1)!; relay.open();
  expect(store.getPmQuoteEntry("h")).toMatchObject({ clobPrice: 0.28, pmQuoteSource: "http-seed" });
  expect(state.refresh).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(state.refresh).toHaveBeenCalledTimes(1);
  relay.book("h", 0.35);
  setPmMarketWsSourceModeAndReconnect("official");
  setPmMarketWsSourceModeAndReconnect("changmen");
  expect(store.getPmQuoteEntry("h")).toMatchObject({ clobPrice: 0.35, pmQuoteSource: "ws" });
});

it("collector stop removes the source listener and discards a pending Index response", async () => {
  let resolve!: (value: unknown) => void;
  state.getPlatform.mockImplementation(() => new Promise(r => { resolve = r; }));
  stop = startPolymarketCollector();
  stop(); stop = undefined;
  resolve({ MarketIndex: index });
  await vi.advanceTimersByTimeAsync(0);
  setPmMarketWsSourceModeAndReconnect("changmen");
  expect(useOddsStore().getPmQuoteEntry("h")).toBeUndefined();
  expect(state.refresh).not.toHaveBeenCalled();
});

it("automatic fallback also restores same-version relay initialization without an extra Index request", async () => {
  const socket = await start(); socket.open();
  await vi.advanceTimersByTimeAsync(8_000);
  expect(useOddsStore().pmMarketWsSourceMode).toBe("changmen");
  expect(useOddsStore().getPmQuoteEntry("h")).toMatchObject({ clobPrice: 0.28, pmQuoteSource: "http-seed" });
  expect(state.getPlatform).toHaveBeenCalledTimes(1);
});

const emptyAsk = (kind: string, timestamp: number) => kind === "book"
  ? { event_type: "book", asset_id: "h", timestamp: String(timestamp), bids: [], asks: [] }
  : kind === "price_change"
    ? { event_type: "price_change", timestamp: String(timestamp), price_changes: [{ asset_id: "h", best_ask: "1" }] }
    : { event_type: "best_bid_ask", asset_id: "h", timestamp: String(timestamp), best_ask: "1" };

it.each(["book", "price_change", "best_bid_ask"])("%s invalidates only the empty side, survives snapshots and Index refresh, then recovers", async kind => {
  const socket = await start(); socket.open(); socket.book("h", 0.35); socket.book("a", 0.65);
  const store = useOddsStore();
  socket.frame(emptyAsk(kind, Date.now()));
  expect(store.getPmQuoteEntry("h")).toMatchObject({ odds: 0, clobPrice: 0, isLock: true, pmQuoteSource: "ws" });
  expect(store.getOdds("Polymarket", "h", 3.571)).toBe(0);
  expect(store.getOdds("Polymarket", "a")).toBe(1.538);
  store.clean("Polymarket");
  expect(store.getOdds("Polymarket", "h", 3.571)).toBe(0);
  setPmMarketWsSourceModeAndReconnect("changmen");
  const relay = Socket.instances.at(-1)!; relay.open();
  index.updatedAt++; await vi.advanceTimersByTimeAsync(30_000);
  expect(store.getOdds("Polymarket", "h", 3.571)).toBe(0);
  relay.book("h", 0.4);
  expect(store.getPmQuoteEntry("h")).toMatchObject({ clobPrice: 0.4, isLock: false, pmQuoteSource: "ws" });
  expect(store.getOdds("Polymarket", "h")).toBe(2.5);
});

it("missing or malformed ask fields and older empty books do not erase a newer quote", async () => {
  const socket = await start(); socket.open(); socket.book("h", 0.35);
  for (const frame of [
    { event_type: "book", asset_id: "h", bids: [] },
    { event_type: "best_bid_ask", asset_id: "h", best_bid: "0.3" },
    { event_type: "price_change", price_changes: [{ asset_id: "h", best_bid: "0.3" }] },
    ...["", " ", "bad", "-1", "1.5"].map(best_ask => ({ event_type: "best_bid_ask", asset_id: "h", best_ask })),
    emptyAsk("book", Date.now() - 1),
  ]) socket.frame(frame);
  expect(useOddsStore().getPmQuoteEntry("h")).toMatchObject({ clobPrice: 0.35, isLock: false });
});
