import { afterEach, expect, it, vi } from "vitest";
import { extractPolymarketWsBestBids } from "@changmen/venue-browser/polymarket/wsQuotes";
import * as market from "@changmen/venue-browser/polymarket/marketQuoteHub";
import * as sport from "@changmen/venue-browser/polymarket/sportQuoteHub";
import * as marketWs from "@changmen/venue-browser/polymarket/ws";
import * as sportWs from "@changmen/venue-browser/polymarket/sportMarketWs";
import { resetPmMarketWsSourceModeForTests } from "@changmen/venue-browser/polymarket/pmMarketWsMode";

afterEach(() => {
  market.__testResetPolymarketMarketQuoteHub();
  sport.__testResetPolymarketSportQuoteHub();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each(["market", "sport"])("%s clears the cached bid when the actual official socket closes", (lane) => {
  class Socket {
    static OPEN = 1;
    static instances: Socket[] = [];
    readyState = 0;
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    send = vi.fn();
    constructor(public url: string) { Socket.instances.push(this); }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", Socket);
  resetPmMarketWsSourceModeForTests("official");
  if (lane === "market") market.registerPolymarketQuoteAssets("esport", ["a"]);
  else sport.setPolymarketSportAssetIds(["a"]);
  const socket = Socket.instances[0]!;
  expect(socket.url).toContain("polymarket.com");
  socket.readyState = Socket.OPEN;
  socket.onopen?.();
  socket.onmessage?.({ data: JSON.stringify({ event_type: "best_bid_ask", asset_id: "a", best_bid: "0.48", best_ask: "0.6" }) });
  const getBid = lane === "market" ? market.getPolymarketMarketBestBid : sport.getPolymarketSportBestBid;
  expect(getBid("a")).toBe(0.48);
  socket.close();
  expect(getBid("a")).toBeNull();
});

it("reads best bid from direct official top-of-book and nested price changes", () => {
  expect(extractPolymarketWsBestBids(JSON.stringify([
    { event_type: "best_bid_ask", asset_id: "a", best_bid: "0.48", best_ask: "0.6", timestamp: "1000" },
    { event_type: "price_change", timestamp: "1001", price_changes: [
      { asset_id: "a", best_bid: "0.49" }, { asset_id: "b", best_ask: "0.7" },
      { asset_id: "c", best_bid: "0" },
    ] },
  ]))).toEqual([
    { assetId: "a", bestBid: 0.48, timestamp: 1000 },
    { assetId: "a", bestBid: 0.49, timestamp: 1001 },
    { assetId: "c", bestBid: null, timestamp: 1001 },
  ]);
  expect(extractPolymarketWsBestBids("PONG")).toEqual([]);
});

it("finds the highest bid with positive size regardless of book order; empty snapshots clear it", () => {
  const book = (bids: unknown[]) => JSON.stringify({ event_type: "book", asset_id: "a", bids });
  expect(extractPolymarketWsBestBids(book([
    { price: "0.52", size: "0" }, { price: "0.48", size: "20" },
    { price: "0.5", size: "3" }, { price: "1", size: "3" }, { price: "0.51", size: "NaN" },
  ]))).toEqual([{ assetId: "a", bestBid: 0.5 }]);
  expect(extractPolymarketWsBestBids(book([]))).toEqual([{ assetId: "a", bestBid: null }]);
  expect(extractPolymarketWsBestBids(JSON.stringify({ event_type: "book", asset_id: "a", asks: [] }))).toEqual([]);
});

it.each(["market", "sport"])("%s WS preserves the ask feed and publishes independent bids", (lane) => {
  const start = lane === "market"
    ? vi.spyOn(marketWs, "startPolymarketMarketWs")
    : vi.spyOn(sportWs, "startPolymarketSportMarketWs");
  start.mockReturnValue({ send: vi.fn(), stop: vi.fn() });
  const bids: string[] = [], asks: number[] = [];
  const getBid = lane === "market" ? market.getPolymarketMarketBestBid : sport.getPolymarketSportBestBid;
  const unBid = (lane === "market" ? market.onPolymarketMarketBid : sport.onPolymarketSportBid)(id => bids.push(id));
  const unAsk = (lane === "market" ? market.onPolymarketMarketQuote : sport.onPolymarketSportQuote)(q => asks.push(q.bestAsk));
  if (lane === "market") market.registerPolymarketQuoteAssets("esport", ["a"]);
  else sport.setPolymarketSportAssetIds(["a"]);
  const options = start.mock.calls[0]![0];
  const send = (payload: unknown) => options.onMessage(JSON.stringify(payload));
  send({ event_type: "best_bid_ask", asset_id: "a", best_bid: "0.48", best_ask: "0.6", timestamp: "1000" });
  expect(getBid("a")).toBe(0.48); expect(asks).toEqual([0.6]);
  send({ event_type: "price_change", timestamp: "1002", price_changes: [{ asset_id: "a", best_bid: "0.49" }] });
  expect(getBid("a")).toBe(0.49); expect(asks).toEqual([0.6]);
  send({ event_type: "best_bid_ask", asset_id: "a", best_bid: "0.45", timestamp: "1001" });
  expect(getBid("a")).toBe(0.49);
  send({ event_type: "best_bid_ask", asset_id: "other", best_bid: "0.5" });
  expect(getBid("other")).toBeNull(); expect(bids).toEqual(["a", "a"]);
  send({ event_type: "book", asset_id: "a", bids: [], timestamp: "1003" });
  expect(getBid("a")).toBeNull();
  send({ event_type: "best_bid_ask", asset_id: "a", best_bid: "0.5", timestamp: "1004" });
  options.onDisconnect?.();
  expect(getBid("a")).toBeNull();
  // Reconnection accepts a fresh snapshot instead of retaining pre-disconnect state.
  options.onOpen();
  send({ event_type: "book", asset_id: "a", bids: [{ price: "0.51", size: "10" }] });
  expect(getBid("a")).toBe(0.51);
  if (lane === "market") market.unregisterPolymarketQuoteConsumer("esport");
  else sport.clearPolymarketSportHub();
  expect(getBid("a")).toBeNull();
  unBid(); unAsk();
});
