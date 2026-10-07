import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cyclePmMarketWsSourceModeAndReconnect,
  getPmMarketClientMetricsSnapshot,
  getPolymarketWsStatus,
  notePolymarketMarketWsSubscription,
  notePolymarketMarketWsQuote,
  resetOfficialFailStreakForTests,
  startPolymarketMarketWs,
} from "./ws";
import { POLYMARKET_MARKET_WS } from "./api";
import { getPmMarketWsSourceMode, resetPmMarketWsSourceModeForTests } from "./pmMarketWsMode";
import { resetPmUserWsSourceModeForTests } from "./pmUserWsMode";
import { markPmTransportManualOverride, resetPmTransportManualOverrideForTests } from "./pmAutoTransport";
import { resetPmRoutingPreferenceForTests, setPmRoutingPreference } from "./pmRoutingPreference";
import { setChangmenAuthTokenGetter } from "../shared/changmenAuthToken";
import { PM_MARKET_WS_FORWARD_PATH } from "./wsConfig";
import { listVenueWsStatuses } from "../shared/venueWsStatus";

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static OPEN = 1;
  url: string;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

describe("polymarket market ws", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
      removeItem: (key: string) => { storage.delete(key); },
    });
    resetPmMarketWsSourceModeForTests("changmen");
    resetPmUserWsSourceModeForTests("changmen");
    resetPmTransportManualOverrideForTests();
    resetPmRoutingPreferenceForTests();
    resetOfficialFailStreakForTests();
    setChangmenAuthTokenGetter(() => "test-jwt");
    vi.stubGlobal("WebSocket", Object.assign(MockWebSocket, { OPEN: 1 }) as unknown as typeof WebSocket);
    vi.useFakeTimers();
  });

  afterEach(() => {
    startPolymarketMarketWs({ onMessage: () => {}, onOpen: () => {} }).stop();
    setChangmenAuthTokenGetter(null);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("cyclePmMarketWsSourceModeAndReconnect keeps callbacks after stop clears active refs", () => {
    const onOpen = vi.fn();
    startPolymarketMarketWs({ onMessage: () => {}, onOpen });
    const first = MockWebSocket.instances[0]!;
    first.open();
    expect(onOpen).toHaveBeenCalledTimes(1);

    cyclePmMarketWsSourceModeAndReconnect();
    expect(MockWebSocket.instances).toHaveLength(2);
    expect(MockWebSocket.instances[1]!.url).toBe(POLYMARKET_MARKET_WS);

    MockWebSocket.instances[1]!.open();
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("facade send still works after cycle (collector closed-over handle)", () => {
    const handle = startPolymarketMarketWs({ onMessage: () => {}, onOpen: () => {} });
    MockWebSocket.instances[0]!.open();
    handle.send("before");
    expect(MockWebSocket.instances[0]!.sent).toContain("before");

    cyclePmMarketWsSourceModeAndReconnect();
    const second = MockWebSocket.instances[1]!;
    second.open();
    handle.send("after-cycle");
    expect(second.sent).toContain("after-cycle");
    expect(MockWebSocket.instances[0]!.sent).not.toContain("after-cycle");
  });

  it("stop closes the live socket (no hub zombie)", () => {
    const handle = startPolymarketMarketWs({ onMessage: () => {}, onOpen: () => {} });
    const first = MockWebSocket.instances[0]!;
    first.open();
    const closeSpy = vi.spyOn(first, "close");
    handle.stop();
    expect(closeSpy).toHaveBeenCalled();
  });

  it("second startPolymarketMarketWs still allows mode cycle", () => {
    startPolymarketMarketWs({ onMessage: () => {}, onOpen: () => {} });
    startPolymarketMarketWs({ onMessage: () => {}, onOpen: () => {} });

    cyclePmMarketWsSourceModeAndReconnect();
    expect(MockWebSocket.instances.at(-1)!.url).toBe(POLYMARKET_MARKET_WS);
  });

  it("falls back to changmen after official WS fails 3 times", () => {
    resetPmMarketWsSourceModeForTests("official");
    startPolymarketMarketWs({ onMessage: () => {}, onOpen: () => {} });
    expect(MockWebSocket.instances[0]!.url).toBe(POLYMARKET_MARKET_WS);

    for (let i = 0; i < 3; i++) {
      MockWebSocket.instances.at(-1)!.close();
      vi.advanceTimersByTime(5_000);
    }

    expect(getPmMarketWsSourceMode()).toBe("changmen");
    expect(MockWebSocket.instances.at(-1)!.url).toContain(PM_MARKET_WS_FORWARD_PATH);
  });

  it("falls back after three short-lived official connections even if they receive quotes", () => {
    resetPmMarketWsSourceModeForTests("official");
    startPolymarketMarketWs({ onMessage: () => {}, onOpen: () => {} });
    for (let i = 0; i < 3; i++) {
      const socket = MockWebSocket.instances.at(-1)!;
      socket.open();
      socket.onmessage?.({ data: JSON.stringify({ event_type: "book", asset_id: "a", asks: [] }) });
      vi.advanceTimersByTime(1_000);
      socket.close();
      vi.advanceTimersByTime(5_000);
    }
    expect(getPmMarketWsSourceMode()).toBe("changmen");
    expect(MockWebSocket.instances.at(-1)!.url).toContain(PM_MARKET_WS_FORWARD_PATH);
  });

  it("clears the official failure streak only after a stable responsive connection", () => {
    resetPmMarketWsSourceModeForTests("official");
    startPolymarketMarketWs({ onMessage: () => {}, onOpen: () => {} });
    MockWebSocket.instances[0]!.close();
    vi.advanceTimersByTime(5_000);
    const stable = MockWebSocket.instances.at(-1)!;
    stable.open();
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(10_000);
      stable.onmessage?.({ data: "PONG" });
    }
    stable.close();
    vi.advanceTimersByTime(5_000);
    MockWebSocket.instances.at(-1)!.close();
    vi.advanceTimersByTime(5_000);
    expect(getPmMarketWsSourceMode()).toBe("official");
  });

  it("times out a stalled handshake and ignores callbacks from the retired socket", () => {
    const onOpen = vi.fn();
    startPolymarketMarketWs({ onMessage: () => {}, onOpen });
    const first = MockWebSocket.instances[0]!;
    vi.advanceTimersByTime(15_000);
    expect(getPolymarketWsStatus()).toBe("error");
    expect(listVenueWsStatuses().find(row => row.id === "pm-market")?.meta?.lastError).toContain("handshake");
    vi.advanceTimersByTime(5_000);
    expect(MockWebSocket.instances).toHaveLength(2);
    first.open();
    first.close();
    expect(onOpen).not.toHaveBeenCalled();
    MockWebSocket.instances[1]!.open();
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(getPolymarketWsStatus()).toBe("connected");
  });

  it("reconnects a silent socket without depending on a close event", () => {
    startPolymarketMarketWs({ onMessage: () => {}, onOpen: () => {} });
    const first = MockWebSocket.instances[0]!;
    first.open();
    first.close = vi.fn();
    vi.advanceTimersByTime(30_000);
    expect(getPolymarketWsStatus()).toBe("error");
    expect(listVenueWsStatuses().find(row => row.id === "pm-market")?.meta?.reason).toBe("heartbeat_timeout");
    vi.advanceTimersByTime(5_000);
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it("keeps a quiet market connected while PONGs continue", () => {
    startPolymarketMarketWs({ onMessage: () => {}, onOpen: () => {} });
    const first = MockWebSocket.instances[0]!;
    first.open();
    for (let i = 0; i < 6; i++) {
      vi.advanceTimersByTime(10_000);
      first.onmessage?.({ data: "PONG" });
    }
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(getPolymarketWsStatus()).toBe("connected");
  });

  it("gives a throttled or suspended browser time to receive PONG before reconnecting", () => {
    startPolymarketMarketWs({ onMessage: () => {}, onOpen: () => {} });
    const first = MockWebSocket.instances[0]!;
    first.open();
    vi.setSystemTime(Date.now() + 120_000);
    vi.advanceTimersByTime(10_000);
    expect(first.sent).toContain("PING");
    expect(getPolymarketWsStatus()).toBe("connected");
    first.onmessage?.({ data: "PONG" });
    vi.advanceTimersByTime(10_000);
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(getPolymarketWsStatus()).toBe("connected");
    vi.advanceTimersByTime(20_000);
    expect(getPolymarketWsStatus()).toBe("error");
    vi.advanceTimersByTime(5_000);
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it("counts one failure when an error is followed by a delayed close", () => {
    resetPmMarketWsSourceModeForTests("official");
    startPolymarketMarketWs({ onMessage: () => {}, onOpen: () => {} });
    const first = MockWebSocket.instances[0]!;
    first.close = vi.fn();
    first.onerror?.();
    first.onclose?.();
    expect(listVenueWsStatuses().find(row => row.id === "pm-market")?.meta?.failStreak).toBe(1);
    vi.advanceTimersByTime(5_000);
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it("does not switch forced official mode after repeated short-lived connections", () => {
    setPmRoutingPreference("official");
    resetPmMarketWsSourceModeForTests("official");
    startPolymarketMarketWs({ onMessage: () => {}, onOpen: () => {} });
    for (let i = 0; i < 3; i++) {
      MockWebSocket.instances.at(-1)!.open();
      MockWebSocket.instances.at(-1)!.close();
      vi.advanceTimersByTime(5_000);
    }
    expect(getPmMarketWsSourceMode()).toBe("official");
  });

  it("does not let a previous connection's book watchdog affect its replacement", () => {
    resetPmMarketWsSourceModeForTests("official");
    startPolymarketMarketWs({ onMessage: () => {}, onOpen: () => {} });
    MockWebSocket.instances[0]!.open();
    notePolymarketMarketWsSubscription(2);
    vi.advanceTimersByTime(2_000);
    MockWebSocket.instances[0]!.close();
    vi.advanceTimersByTime(5_000);
    MockWebSocket.instances[1]!.open();
    vi.advanceTimersByTime(2_000);
    expect(getPmMarketWsSourceMode()).toBe("official");
    expect(getPolymarketWsStatus()).toBe("connected");
  });

  it("starts the book timeout after open and does not extend it on subscription updates", () => {
    resetPmMarketWsSourceModeForTests("official");
    startPolymarketMarketWs({ onMessage: () => {}, onOpen: () => {} });
    notePolymarketMarketWsSubscription(2);
    vi.advanceTimersByTime(9_000);
    expect(getPmMarketWsSourceMode()).toBe("official");
    MockWebSocket.instances[0]!.open();
    vi.advanceTimersByTime(4_000);
    notePolymarketMarketWsSubscription(3);
    vi.advanceTimersByTime(4_000);
    expect(getPmMarketWsSourceMode()).toBe("changmen");
  });

  it("does not rearm first-book fallback for subscription changes on an established feed", () => {
    resetPmMarketWsSourceModeForTests("official");
    startPolymarketMarketWs({ onMessage: () => {}, onOpen: () => {} });
    const first = MockWebSocket.instances[0]!;
    first.open();
    notePolymarketMarketWsSubscription(2);
    first.onmessage?.({ data: JSON.stringify({ event_type: "book", asset_id: "a", asks: [] }) });
    notePolymarketMarketWsSubscription(3);
    vi.advanceTimersByTime(8_000);
    expect(getPmMarketWsSourceMode()).toBe("official");
    expect(getPmMarketClientMetricsSnapshot().emptyBookCount).toBe(0);
  });

  it("stop cancels handshake and first-book recovery timers", () => {
    resetPmMarketWsSourceModeForTests("official");
    const handle = startPolymarketMarketWs({ onMessage: () => {}, onOpen: () => {} });
    MockWebSocket.instances[0]!.open();
    notePolymarketMarketWsSubscription(2);
    handle.stop();
    vi.advanceTimersByTime(60_000);
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(getPmMarketWsSourceMode()).toBe("official");
    expect(getPolymarketWsStatus()).toBe("disconnected");
  });

  it("falls back to changmen when official receives no book after subscribing real assets", () => {
    resetPmMarketWsSourceModeForTests("official");
    startPolymarketMarketWs({ onMessage: () => {}, onOpen: () => {} });
    MockWebSocket.instances[0]!.open();

    notePolymarketMarketWsSubscription(2);
    vi.advanceTimersByTime(8_000);
    vi.advanceTimersByTime(5_000);

    expect(getPmMarketWsSourceMode()).toBe("changmen");
    expect(MockWebSocket.instances.at(-1)!.url).toContain(PM_MARKET_WS_FORWARD_PATH);
  });

  it("does not treat non-quote json as a book frame for official watchdog", () => {
    resetPmMarketWsSourceModeForTests("official");
    startPolymarketMarketWs({ onMessage: () => {}, onOpen: () => {} });
    MockWebSocket.instances[0]!.open();

    notePolymarketMarketWsSubscription(2);
    MockWebSocket.instances[0]!.onmessage?.({ data: JSON.stringify({ event_type: "subscribed", status: "ok" }) });
    vi.advanceTimersByTime(8_000);
    vi.advanceTimersByTime(5_000);

    expect(getPmMarketWsSourceMode()).toBe("changmen");
    expect(MockWebSocket.instances.at(-1)!.url).toContain(PM_MARKET_WS_FORWARD_PATH);
  });

  it("keeps official mode when a real quote frame arrives before watchdog timeout", () => {
    resetPmMarketWsSourceModeForTests("official");
    startPolymarketMarketWs({ onMessage: () => {}, onOpen: () => {} });
    MockWebSocket.instances[0]!.open();

    notePolymarketMarketWsSubscription(2);
    MockWebSocket.instances[0]!.onmessage?.({
      data: JSON.stringify({ event_type: "best_bid_ask", asset_id: "asset-a", best_ask: "0.42" }),
    });
    vi.advanceTimersByTime(8_000);

    expect(getPmMarketWsSourceMode()).toBe("official");
  });

  it("records connect and first frame metrics without changing transport", () => {
    resetPmMarketWsSourceModeForTests("official");
    startPolymarketMarketWs({ onMessage: () => {}, onOpen: () => {} });
    vi.advanceTimersByTime(25);
    MockWebSocket.instances[0]!.open();
    notePolymarketMarketWsSubscription(2);
    vi.advanceTimersByTime(40);
    MockWebSocket.instances[0]!.onmessage?.({
      data: JSON.stringify({ event_type: "best_bid_ask", asset_id: "asset-a", best_ask: "0.42" }),
    });

    const metrics = getPmMarketClientMetricsSnapshot();
    expect(metrics.mode).toBe("official");
    expect(metrics.connectMs).toBe(25);
    expect(metrics.firstFrameMs).toBe(40);
    expect(metrics.assetCount).toBe(2);
    expect(metrics.connectionAttemptCount).toBe(1);
    expect(metrics.reconnectCount).toBe(0);
    expect(metrics.lastReason).toBe("subscribed_assets");
  });

  it("records first usable quote separately from first frame", () => {
    resetPmMarketWsSourceModeForTests("official");
    startPolymarketMarketWs({ onMessage: () => {}, onOpen: () => {} });
    MockWebSocket.instances[0]!.open();
    notePolymarketMarketWsSubscription(2);
    vi.advanceTimersByTime(30);
    MockWebSocket.instances[0]!.onmessage?.({
      data: JSON.stringify({ event_type: "subscribed", status: "ok" }),
    });
    vi.advanceTimersByTime(70);
    notePolymarketMarketWsQuote(Date.now() - 12);

    const metrics = getPmMarketClientMetricsSnapshot();
    expect(metrics.firstFrameMs).toBe(30);
    expect(metrics.firstQuoteMs).toBe(100);
    expect(metrics.quoteFreshMs).toBe(12);
    expect(metrics.lastReason).toBe("quote");
  });

  it("records empty book fallback reason on official watchdog timeout", () => {
    resetPmMarketWsSourceModeForTests("official");
    startPolymarketMarketWs({ onMessage: () => {}, onOpen: () => {} });
    MockWebSocket.instances[0]!.open();

    notePolymarketMarketWsSubscription(2);
    vi.advanceTimersByTime(8_000);

    const metrics = getPmMarketClientMetricsSnapshot();
    expect(metrics.emptyBookCount).toBe(1);
    expect(metrics.fallbackReason).toBe("official_no_book_timeout");
  });

  it("does not fallback on no-book timeout when user forces official", () => {
    setPmRoutingPreference("official");
    resetPmMarketWsSourceModeForTests("official");
    startPolymarketMarketWs({ onMessage: () => {}, onOpen: () => {} });
    MockWebSocket.instances[0]!.open();

    notePolymarketMarketWsSubscription(2);
    vi.advanceTimersByTime(8_000);
    vi.advanceTimersByTime(5_000);

    expect(getPmMarketWsSourceMode()).toBe("official");
    expect(MockWebSocket.instances.at(-1)!.url).toBe(POLYMARKET_MARKET_WS);
  });

  it("legacy manual override does not block auto no-book fallback", () => {
    resetPmMarketWsSourceModeForTests("official");
    markPmTransportManualOverride();
    startPolymarketMarketWs({ onMessage: () => {}, onOpen: () => {} });
    MockWebSocket.instances[0]!.open();

    notePolymarketMarketWsSubscription(2);
    vi.advanceTimersByTime(8_000);
    vi.advanceTimersByTime(5_000);

    expect(getPmMarketWsSourceMode()).toBe("changmen");
    expect(MockWebSocket.instances.at(-1)!.url).toContain(PM_MARKET_WS_FORWARD_PATH);
  });
});
