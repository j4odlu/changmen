import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POLYMARKET_MARKET_WS } from "../../api";
import { getPmMarketWsSourceMode, resetPmMarketWsSourceModeForTests, setPmMarketWsSourceMode } from "../../pmMarketWsMode";
import { startPolymarketSportMarketWs } from "../../sportMarketWs";
import { PM_SPORT_MARKET_WS_FORWARD_PATH } from "../../sportWsConfig";

class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  send() {}
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  setPmMarketWsSourceMode("official");
});

afterEach(() => {
  resetPmMarketWsSourceModeForTests();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("pM football market WS fallback", () => {
  it("falls back to the isolated sport relay without changing esport mode", () => {
    const handle = startPolymarketSportMarketWs({ onMessage() {}, onOpen() {} });
    expect(FakeWebSocket.instances[0]?.url).toBe(POLYMARKET_MARKET_WS);

    FakeWebSocket.instances[0]?.onerror?.();
    vi.advanceTimersByTime(5_000);

    expect(FakeWebSocket.instances[1]?.url).toContain(PM_SPORT_MARKET_WS_FORWARD_PATH);
    expect(getPmMarketWsSourceMode()).toBe("official");
    handle.stop();
  });

  it("probes official again after a stable relay minute", () => {
    const handle = startPolymarketSportMarketWs({ onMessage() {}, onOpen() {} });
    FakeWebSocket.instances[0]?.onerror?.();
    vi.advanceTimersByTime(5_000);
    FakeWebSocket.instances[1]?.onopen?.();
    vi.advanceTimersByTime(60_000);
    vi.advanceTimersByTime(1);

    expect(FakeWebSocket.instances.at(-1)?.url).toBe(POLYMARKET_MARKET_WS);
    handle.stop();
  });
});
