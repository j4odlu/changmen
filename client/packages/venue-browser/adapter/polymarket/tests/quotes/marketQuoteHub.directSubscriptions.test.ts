import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  __testResetPolymarketMarketQuoteHub, ensurePolymarketMarketQuoteHub,
  getPolymarketMarketBestBid, onPolymarketMarketQuote,
  onPolymarketMarketAskUnavailable,
  onPolymarketMarketHubReady, registerPolymarketQuoteAssets, unregisterPolymarketQuoteConsumer,
} from "@changmen/venue-browser/polymarket/marketQuoteHub";
import {
  resetOfficialFailStreakForTests, setPmMarketWsSourceModeAndReconnect,
} from "@changmen/venue-browser/polymarket/ws";
import {
  resetPmMarketWsSourceModeForTests, setPmMarketWsSourceMode,
} from "@changmen/venue-browser/polymarket/pmMarketWsMode";
import { resetPmRoutingPreferenceForTests } from "@changmen/venue-browser/polymarket/pmRoutingPreference";
import { resetPolymarketLiveQuoteTsForTests } from "@changmen/venue-browser/polymarket/liveQuoteState";

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
  send(value: string) { this.sent.push(value); }
  open() { this.readyState = Socket.OPEN; this.onopen?.(); }
  frame(payload: unknown) { this.onmessage?.({ data: JSON.stringify(payload) }); }
  close() { this.readyState = 3; this.onclose?.(); }
  frames() { return this.sent.filter(raw => raw !== "PING").map(raw => JSON.parse(raw)); }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", Socket);
  Socket.instances = [];
  resetPmMarketWsSourceModeForTests("official");
  resetPmRoutingPreferenceForTests();
  resetOfficialFailStreakForTests();
  resetPolymarketLiveQuoteTsForTests();
});
afterEach(() => {
  __testResetPolymarketMarketQuoteHub();
  resetPmMarketWsSourceModeForTests("changmen");
  vi.clearAllTimers();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  resetPolymarketLiveQuoteTsForTests();
});

function connected(ids = ["a", "b"]) {
  registerPolymarketQuoteAssets("first", ids);
  const socket = Socket.instances[0]!;
  socket.open();
  return socket;
}

it("sends the complete current union once on open, including changes made while connecting", async () => {
  const unReady = onPolymarketMarketHubReady(() => registerPolymarketQuoteAssets("first", ["a", "b"], true));
  registerPolymarketQuoteAssets("first", ["a"]);
  registerPolymarketQuoteAssets("first", ["a", "b"]);
  registerPolymarketQuoteAssets("second", ["b", "c"]);
  const socket = Socket.instances[0]!;
  expect(socket.frames()).toEqual([]);
  socket.open();
  await Promise.resolve();
  expect(Socket.instances).toHaveLength(1);
  expect(socket.frames()).toEqual([{
    assets_ids: ["a", "b", "c"], type: "market", custom_feature_enabled: true, initial_dump: true,
  }]);
  unReady();
});

it("adds and removes only the changed assets; identical, reordered and forced sets send nothing", () => {
  const socket = connected();
  registerPolymarketQuoteAssets("first", [" b ", "a", "a"]);
  registerPolymarketQuoteAssets("first", ["b", "a"], true);
  expect(socket.frames()).toHaveLength(1);
  registerPolymarketQuoteAssets("first", ["b", "c"]);
  expect(socket.frames().slice(1)).toEqual([
    { assets_ids: ["c"], operation: "subscribe", custom_feature_enabled: true },
    { assets_ids: ["a"], operation: "unsubscribe" },
  ]);
});

it("late consumers subscribe only new assets, and shared assets remain until their last consumer leaves", () => {
  const socket = connected();
  registerPolymarketQuoteAssets("second", ["b", "c"]);
  unregisterPolymarketQuoteConsumer("first");
  expect(socket.frames().slice(1)).toEqual([
    { assets_ids: ["c"], operation: "subscribe", custom_feature_enabled: true },
    { assets_ids: ["a"], operation: "unsubscribe" },
  ]);
  registerPolymarketQuoteAssets("third", ["b"]);
  registerPolymarketQuoteAssets("second", []);
  expect(socket.frames().at(-1)).toEqual({ assets_ids: ["c"], operation: "unsubscribe" });
  expect(socket.readyState).toBe(Socket.OPEN);
  unregisterPolymarketQuoteConsumer("third");
  expect(socket.readyState).toBe(3);
});

it("preconnect sends no empty frame and the first late asset set uses one initial market frame", () => {
  ensurePolymarketMarketQuoteHub();
  const socket = Socket.instances[0]!;
  socket.open();
  expect(socket.frames()).toEqual([]);
  registerPolymarketQuoteAssets("first", ["a"]);
  expect(socket.frames()).toEqual([{
    assets_ids: ["a"], type: "market", custom_feature_enabled: true, initial_dump: true,
  }]);
});

it("reconnects with the latest complete union and forgets the old connection's sent set", async () => {
  const first = connected();
  first.close();
  registerPolymarketQuoteAssets("first", ["b", "c"]);
  registerPolymarketQuoteAssets("second", ["d"]);
  await vi.advanceTimersByTimeAsync(5_000);
  const next = Socket.instances[1]!;
  expect(next.frames()).toEqual([]);
  next.open();
  expect(next.frames()).toEqual([{
    assets_ids: ["b", "c", "d"], type: "market", custom_feature_enabled: true, initial_dump: true,
  }]);
  registerPolymarketQuoteAssets("first", ["c"]);
  expect(next.frames().at(-1)).toEqual({ assets_ids: ["b"], operation: "unsubscribe" });
});

it("uses the socket's actual source even if the preference changes before its open event", () => {
  registerPolymarketQuoteAssets("first", ["a"]);
  const socket = Socket.instances[0]!;
  setPmMarketWsSourceMode("changmen");
  socket.open();
  registerPolymarketQuoteAssets("first", ["a", "b"]);
  expect(socket.url).toContain("polymarket.com");
  expect(socket.frames().at(-1)).toEqual({ assets_ids: ["b"], operation: "subscribe", custom_feature_enabled: true });
});

it("keeps relay full-set messages on fallback and starts fresh when switched back to official", () => {
  connected(["a"]);
  setPmMarketWsSourceModeAndReconnect("changmen");
  const relay = Socket.instances[1]!;
  relay.open();
  registerPolymarketQuoteAssets("first", ["a", "b"]);
  expect(relay.url).toContain("/PM-MARKET");
  expect(relay.frames()).toEqual([
    { assets_ids: ["a"], type: "market", custom_feature_enabled: true, initial_dump: true },
    { assets_ids: ["a", "b"], type: "market", custom_feature_enabled: true, initial_dump: false },
  ]);
  setPmMarketWsSourceModeAndReconnect("official");
  const official = Socket.instances[2]!;
  official.open();
  registerPolymarketQuoteAssets("first", ["b"]);
  expect(official.frames()).toEqual([
    { assets_ids: ["a", "b"], type: "market", custom_feature_enabled: true, initial_dump: true },
    { assets_ids: ["a"], operation: "unsubscribe" },
  ]);
});

it("keeps existing quotes usable during a diff and receives books and live updates for added assets", () => {
  const quotes: Array<{ assetId: string; bestAsk: number }> = [];
  onPolymarketMarketQuote(quote => quotes.push(quote));
  const socket = connected();
  socket.frame({ event_type: "best_bid_ask", asset_id: "a", best_bid: "0.4", best_ask: "0.5" });
  socket.frame({ event_type: "best_bid_ask", asset_id: "b", best_bid: "0.6", best_ask: "0.7" });
  registerPolymarketQuoteAssets("first", ["b", "c"]);
  expect(getPolymarketMarketBestBid("a")).toBeNull();
  expect(getPolymarketMarketBestBid("b")).toBe(0.6);
  socket.frame({ event_type: "book", asset_id: "c",
    bids: [{ price: "0.2", size: "10" }], asks: [{ price: "0.3", size: "10" }] });
  socket.frame({ event_type: "price_change", price_changes: [
    { asset_id: "b", best_bid: "0.61", best_ask: "0.71" },
    { asset_id: "c", best_bid: "0.21", best_ask: "0.31" },
  ] });
  expect(quotes).toEqual([
    { assetId: "a", bestAsk: 0.5 }, { assetId: "b", bestAsk: 0.7 },
    { assetId: "c", bestAsk: 0.3 }, { assetId: "b", bestAsk: 0.71 },
    { assetId: "c", bestAsk: 0.31 },
  ]);
  expect(getPolymarketMarketBestBid("b")).toBe(0.61);
  expect(getPolymarketMarketBestBid("c")).toBe(0.21);
  socket.frame({ event_type: "best_bid_ask", asset_id: "a", best_bid: "0.41" });
  expect(getPolymarketMarketBestBid("a")).toBeNull();
  expect(Socket.instances).toHaveLength(1);
  expect(socket.frames()).toHaveLength(3);
});

it("ignores late callbacks from a replaced socket without clearing the new connection's subscriptions or quotes", () => {
  const quotes: number[] = [];
  onPolymarketMarketQuote(quote => quotes.push(quote.bestAsk));
  const old = connected(["a"]);
  setPmMarketWsSourceModeAndReconnect("official");
  const current = Socket.instances[1]!;
  current.open();
  current.frame({ event_type: "best_bid_ask", asset_id: "a", best_bid: "0.4", best_ask: "0.5" });
  old.open();
  old.frame({ event_type: "best_bid_ask", asset_id: "a", best_bid: "0.1", best_ask: "0.2" });
  old.close();
  old.onerror?.();
  expect(quotes).toEqual([0.5]);
  expect(getPolymarketMarketBestBid("a")).toBe(0.4);
  registerPolymarketQuoteAssets("first", ["a", "b"]);
  expect(current.frames()).toEqual([
    { assets_ids: ["a"], type: "market", custom_feature_enabled: true, initial_dump: true },
    { assets_ids: ["b"], operation: "subscribe", custom_feature_enabled: true },
  ]);
});

it("automatically falls back with the latest desired set when official sends no book", async () => {
  const official = connected(["a"]);
  registerPolymarketQuoteAssets("first", ["a", "b"]);
  await vi.advanceTimersByTimeAsync(8_000);
  expect(official.readyState).toBe(3);
  registerPolymarketQuoteAssets("first", ["b", "c"]);
  await vi.advanceTimersByTimeAsync(5_000);
  const relay = Socket.instances[1]!;
  expect(relay.url).toContain("/PM-MARKET");
  expect(relay.frames()).toEqual([]);
  relay.open();
  registerPolymarketQuoteAssets("first", ["c"]);
  expect(relay.frames()).toEqual([
    { assets_ids: ["b", "c"], type: "market", custom_feature_enabled: true, initial_dump: true },
    { assets_ids: ["c"], type: "market", custom_feature_enabled: true, initial_dump: false },
  ]);
});

it("notifies subscribed empty asks separately without passing invalid prices to quote listeners", () => {
  const quotes: number[] = [], unavailable: string[] = [];
  onPolymarketMarketQuote(q => quotes.push(q.bestAsk));
  const off = onPolymarketMarketAskUnavailable(id => unavailable.push(id));
  const socket = connected(["a"]);
  const frame = (asset_id: string, best_ask: string, timestamp: number) =>
    socket.frame({ event_type: "best_bid_ask", asset_id, best_ask, timestamp: String(timestamp) });
  frame("a", "0.35", 100);
  socket.frame({ event_type: "book", asset_id: "a", asks: [], timestamp: "101" });
  frame("a", "1", 102);
  frame("a", "0", 103);
  frame("a", "1", 99); // An older empty update must not lock a fresh price.
  frame("other", "1", 104);
  for (const invalid of ["", " ", "bad", "-1", "1.5"]) frame("a", invalid, 104);
  expect(unavailable).toEqual(["a", "a", "a"]);
  expect(quotes).toEqual([0.35]);
  off();
  frame("a", "1", 105);
  frame("a", "0.4", 106);
  expect(unavailable).toEqual(["a", "a", "a"]);
  expect(quotes).toEqual([0.35, 0.4]);
});
