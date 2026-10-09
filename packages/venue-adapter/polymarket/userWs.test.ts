import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  awaitPolymarketOrderWatch,
  cyclePmUserWsSourceModeAndReconnect,
  registerPolymarketOrderWatch,
  stopAllPolymarketUserWs,
  warmAllPolymarketUserWs,
  warmPolymarketUserWs,
  readPolymarketOrderWatch,
  observePolymarketOrderWatch,
} from "./userWs";
import { POLYMARKET_USER_WS } from "./api";
import { resetPmUserWsSourceModeForTests } from "./pmUserWsMode";
const diagnosticLog = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@changmen/client-core/bridge/clientApi", () => ({ saveUserLog: diagnosticLog }));

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

function pmAccount(): PlatformAccount {
  return {
    provider: "Polymarket",
    token: JSON.stringify({
      apiKey: "key-1",
      secret: "secret-1",
      passphrase: "pass-1",
    }),
  } as PlatformAccount;
}

describe("polymarket user ws", () => {
  it("retains cumulative fills after an initial partial fill", async () => {
    const account = pmAccount();
    registerPolymarketOrderWatch(account, "partial", { conditionId: "market" });
    const ws = MockWebSocket.instances[0]!;
    ws.open();
    const emit = (size: string) => ws.onmessage?.({ data: JSON.stringify({ event_type: "order", type: "UPDATE", id: "partial", size_matched: size, original_size: "10" }) });
    emit("3");
    expect((await awaitPolymarketOrderWatch("partial", account))?.row?.size_matched).toBe("3");
    emit("10");
    emit("3");
    expect(readPolymarketOrderWatch("partial", account)?.row?.size_matched).toBe("10");
  });
  beforeEach(() => {
    diagnosticLog.mockClear();
    MockWebSocket.instances = [];
    resetPmUserWsSourceModeForTests("changmen");
    vi.stubGlobal("WebSocket", Object.assign(MockWebSocket, { OPEN: 1 }) as unknown as typeof WebSocket);
  });

  it("records unknown related WS messages while keeping the original order pending", () => {
    const account = pmAccount();
    registerPolymarketOrderWatch(account, "unknown", { conditionId: "market" });
    const socket = MockWebSocket.instances[0]!;
    socket.open();
    socket.onmessage?.({ data: JSON.stringify({ id: "unknown", errorMsg: "FOK_ORDER_NOT_FILLED_ERROR", secret: "must-not-leak" }) });
    expect(readPolymarketOrderWatch("unknown", account)).toBeNull();
    expect(diagnosticLog).toHaveBeenCalledWith("PM 原单时序 / ws_event", expect.objectContaining({ interpretation: "missing_event_type", errorCategory: "fok_not_filled", replayed: false }));
    expect(JSON.stringify(diagnosticLog.mock.calls)).not.toContain("must-not-leak");
  });
  it("records cached FAILED trade evidence registered after ACK without inventing a rejection", () => {
    const account = pmAccount();
    warmPolymarketUserWs(account);
    const socket = MockWebSocket.instances[0]!;
    socket.open();
    socket.onmessage?.({ data: JSON.stringify({ event_type: "trade", type: "TRADE", status: "FAILED", taker_order_id: "failed" }) });
    registerPolymarketOrderWatch(account, "failed", { conditionId: "market" });
    expect(readPolymarketOrderWatch("failed", account)).toBeNull();
    expect(diagnosticLog).toHaveBeenCalledWith("PM 原单时序 / ws_event", expect.objectContaining({ interpretation: "trade_failed", replayed: true, status: "FAILED" }));
  });

  afterEach(() => {
    stopAllPolymarketUserWs();
    vi.unstubAllGlobals();
  });

  it("restores an order observer without market metadata and unsubscribes cleanly", () => {
    const listener = vi.fn();
    const unsubscribe = observePolymarketOrderWatch(pmAccount(), "restored", listener);
    const socket = MockWebSocket.instances[0]!;
    socket.open();
    expect(listener).toHaveBeenCalledWith("connected");
    socket.onmessage?.({ data: JSON.stringify({ event_type: "order", type: "UPDATE", id: "restored", size_matched: "10" }) });
    expect(listener).toHaveBeenCalledWith("update");
    unsubscribe();
    listener.mockClear();
    socket.onmessage?.({ data: JSON.stringify({ event_type: "order", type: "UPDATE", id: "restored", size_matched: "10" }) });
    expect(listener).not.toHaveBeenCalled();
  });

  it("warmPolymarketUserWs opens authenticated session without order watch", () => {
    expect(warmPolymarketUserWs(pmAccount())).toBe(true);
    expect(MockWebSocket.instances).toHaveLength(1);
    const ws = MockWebSocket.instances[0]!;
    ws.open();
    const subscribe = JSON.parse(ws.sent[0]!);
    expect(subscribe.type).toBe("user");
    expect(subscribe.auth.apiKey).toBe("key-1");
    expect(subscribe.markets).toEqual([]);
  });

  it("warmAllPolymarketUserWs dedupes by apiKey", () => {
    warmAllPolymarketUserWs([
      pmAccount(),
      pmAccount(),
      { provider: "OB" } as PlatformAccount,
    ]);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("register subscribes condition_id and resolves matched on trade", async () => {
    registerPolymarketOrderWatch(pmAccount(), "0xorder", {
      conditionId: "0xcondition",
      timeoutMs: 5_000,
    });

    expect(MockWebSocket.instances).toHaveLength(1);
    const ws = MockWebSocket.instances[0]!;
    ws.open();
    const subscribe = JSON.parse(ws.sent[0]!);
    expect(subscribe.markets).toEqual([]);

    ws.onmessage?.({
      data: JSON.stringify({
        event_type: "trade",
        type: "TRADE",
        status: "MATCHED",
        taker_order_id: "0xorder",
        size: "12",
      }),
    });

    const result = await awaitPolymarketOrderWatch("0xorder");
    expect(result?.outcome).toBe("matched");
    expect(result?.row?.size_matched).toBe("12");
  });

  it("cyclePmUserWsSourceModeAndReconnect switches to official url", () => {
    warmPolymarketUserWs(pmAccount());
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0]!.url).toContain("/esport/ws-forward/PM-USER");

    cyclePmUserWsSourceModeAndReconnect();
    expect(MockWebSocket.instances).toHaveLength(2);
    expect(MockWebSocket.instances[1]!.url).toBe(POLYMARKET_USER_WS);
  });

  it("cycle after open does not orphan the new socket on stale onclose", () => {
    warmPolymarketUserWs(pmAccount());
    const first = MockWebSocket.instances[0]!;
    first.open();
    expect(first.readyState).toBe(MockWebSocket.OPEN);

    cyclePmUserWsSourceModeAndReconnect();
    const second = MockWebSocket.instances[1]!;
    second.open();

    first.close();
    expect(second.readyState).toBe(MockWebSocket.OPEN);
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it("reconnects after the replacement socket disconnects following a source switch", async () => {
    vi.useFakeTimers();
    try {
      warmPolymarketUserWs(pmAccount(), "market");
      MockWebSocket.instances[0]!.open();
      cyclePmUserWsSourceModeAndReconnect();
      const replacement = MockWebSocket.instances[1]!;
      replacement.open();
      replacement.close();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(MockWebSocket.instances).toHaveLength(3);
      const reconnected = MockWebSocket.instances[2]!;
      reconnected.open();
      expect(JSON.parse(reconnected.sent[0]!).markets).toEqual([]);
    }
    finally {
      stopAllPolymarketUserWs();
      vi.useRealTimers();
    }
  });

  it("does not treat blank cancellation quantities as confirmed zero fill", () => {
    const account = pmAccount();
    registerPolymarketOrderWatch(account, "blank", { conditionId: "market" });
    const ws = MockWebSocket.instances[0]!;
    ws.open();
    for (const size of ["", "  "]) {
      ws.onmessage?.({ data: JSON.stringify({ event_type: "order", type: "CANCELLATION", id: "blank", size_matched: size }) });
      expect(readPolymarketOrderWatch("blank", account)).toBeNull();
    }
  });

  it("watch resolves null on timeout so REST poll can continue", async () => {
    vi.useFakeTimers();
    registerPolymarketOrderWatch(pmAccount(), "0xlate", {
      conditionId: "0xcondition",
      timeoutMs: 1_000,
    });
    const pending = awaitPolymarketOrderWatch("0xlate");
    await vi.advanceTimersByTimeAsync(1_100);
    expect(await pending).toBeNull();
    MockWebSocket.instances[0]!.onmessage?.({ data: JSON.stringify({
      event_type: "order", type: "CANCELLATION", id: "0xlate", size_matched: "0",
    }) });
    expect((await awaitPolymarketOrderWatch("0xlate"))?.outcome).toBe("unfilled");
    vi.useRealTimers();
  });

  it("replays an event that arrived before the HTTP ACK registered its watch", async () => {
    warmPolymarketUserWs(pmAccount());
    const ws = MockWebSocket.instances[0]!;
    ws.open();
    ws.onmessage?.({ data: JSON.stringify([{ event_type: "trade", status: "MATCHED",
      taker_order_id: "early", size: "12" }]) });
    registerPolymarketOrderWatch(pmAccount(), "early", { conditionId: "condition" });
    expect((await awaitPolymarketOrderWatch("early"))?.outcome).toBe("matched");
  });

  it("keeps account-wide subscription when submitting orders in new markets", async () => {
    const account = pmAccount();
    warmPolymarketUserWs(account, "old-market");
    const socket = MockWebSocket.instances[0]!;
    socket.open();
    warmPolymarketUserWs(account, "new-market");
    expect(socket.sent).toHaveLength(1);
    expect(JSON.parse(socket.sent[0]!)).toMatchObject({ type: "user", markets: [] });
    socket.onmessage?.({ data: JSON.stringify({ event_type: "order", type: "CANCELLATION", id: "before-ack", size_matched: "0" }) });
    registerPolymarketOrderWatch(account, "before-ack", { conditionId: "new-market" });
    expect((await awaitPolymarketOrderWatch("before-ack", account))?.outcome).toBe("unfilled");
  });

  it("does not consume another authenticated account's events", async () => {
    vi.useFakeTimers();
    const other = { ...pmAccount(), token: JSON.stringify({ apiKey: "other", secret: "s", passphrase: "p" }) } as PlatformAccount;
    registerPolymarketOrderWatch(pmAccount(), "isolated", { conditionId: "c", timeoutMs: 10 });
    warmPolymarketUserWs(other);
    MockWebSocket.instances[1]!.onmessage?.({ data: JSON.stringify({
      event_type: "trade", status: "MATCHED", taker_order_id: "isolated", size: "12",
    }) });
    await vi.advanceTimersByTimeAsync(11);
    expect(await awaitPolymarketOrderWatch("isolated")).toBeNull();
    vi.useRealTimers();
  });
});
