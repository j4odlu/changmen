import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as market from "@changmen/venue-browser/polymarket/marketQuoteHub";
import * as sport from "@changmen/venue-browser/polymarket/sportQuoteHub";
import * as oldMarket from "../../marketQuoteHub";
import * as oldSport from "../../sportQuoteHub";
import { resetPmMarketWsSourceModeForTests } from "@changmen/venue-browser/polymarket/pmMarketWsMode";
import { resetPmRoutingPreferenceForTests } from "@changmen/venue-browser/polymarket/pmRoutingPreference";
import { resetOfficialFailStreakForTests } from "@changmen/venue-browser/polymarket/ws";
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
  close() { this.readyState = 3; this.onclose?.(); }
}
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal("WebSocket", Socket); Socket.instances = [];
  resetPmMarketWsSourceModeForTests("changmen"); resetPmRoutingPreferenceForTests();
  resetOfficialFailStreakForTests(); resetPolymarketLiveQuoteTsForTests();
});
afterEach(() => {
  market.__testResetPolymarketMarketQuoteHub(); sport.__testResetPolymarketSportQuoteHub();
  vi.unstubAllGlobals(); vi.useRealTimers();
});
it("mixed old/new entry calls keep one market connection and an independent sport connection across reconnect and teardown", async () => {
  expect(Socket.instances).toHaveLength(0);
  market.registerPolymarketQuoteAssets("first", ["e1"]);
  oldMarket.registerPolymarketQuoteAssets("second", ["e2"]);
  oldSport.setPolymarketSportAssetIds(["s1"]);
  expect(Socket.instances).toHaveLength(2);
  const [esportSocket, sportSocket] = Socket.instances as [Socket, Socket];
  esportSocket.open(); sportSocket.open();
  expect(JSON.parse(esportSocket.sent.at(-1)!)).toMatchObject({ assets_ids: ["e1", "e2"], initial_dump: true });
  expect(JSON.parse(sportSocket.sent.at(-1)!)).toMatchObject({ assets_ids: ["s1"], initial_dump: true });
  const received = vi.fn(), stop = oldMarket.onPolymarketMarketQuote(received);
  try {
    esportSocket.onmessage?.({ data: JSON.stringify({ event_type: "best_bid_ask", asset_id: "e1", best_ask: "0.5", timestamp: 100 }) });
    expect(received).toHaveBeenCalledExactlyOnceWith({ assetId: "e1", bestAsk: 0.5 });
    esportSocket.close(); await vi.advanceTimersByTimeAsync(5_000);
    expect(Socket.instances).toHaveLength(3);
    const reconnected = Socket.instances[2]!; reconnected.open();
    expect(JSON.parse(reconnected.sent.at(-1)!)).toMatchObject({ assets_ids: ["e1", "e2"], initial_dump: true });
    expect(sportSocket.readyState).toBe(Socket.OPEN);
    oldMarket.unregisterPolymarketQuoteConsumer("first");
    expect(reconnected.readyState).toBe(Socket.OPEN);
    expect(JSON.parse(reconnected.sent.at(-1)!)).toMatchObject({ assets_ids: ["e2"], initial_dump: false });
    market.unregisterPolymarketQuoteConsumer("second");
    expect(reconnected.readyState).toBe(3); expect(sportSocket.readyState).toBe(Socket.OPEN);
    sport.clearPolymarketSportHub(); expect(sportSocket.readyState).toBe(3);
    await vi.advanceTimersByTimeAsync(60_000); expect(Socket.instances).toHaveLength(3);
  } finally { stop(); }
});
