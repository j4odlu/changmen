import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ order: vi.fn(), trade: vi.fn(), cancel: vi.fn(), trace: vi.fn() }));
vi.mock("./orders", () => ({ fetchPolymarketConfirmedTradeForOrder: mocks.trade }));
vi.mock("./pmClientApi", () => ({ pmCancelOrder: mocks.cancel }));
vi.mock("./orderTrace", async original => ({ ...await original<typeof import("./orderTrace")>(), tracePolymarketOrder: mocks.trace }));
vi.mock("./orderStatus", async (original) => ({
  ...await original<typeof import("./orderStatus")>(), fetchPolymarketOrderRow: mocks.order,
}));
import { settlePolymarketDelayedOrder } from "./orderSettlement";
import { registerPolymarketOrderWatch, stopAllPolymarketUserWs, readPolymarketOrderWatch } from "./userWs";
import { resetPmUserWsSourceModeForTests } from "./pmUserWsMode";

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 0;
  onopen?: () => void;
  onclose?: () => void;
  onerror?: () => void;
  onmessage?: (event: { data: string }) => void;
  send = vi.fn();
  constructor(_url: string) { Socket.instances.push(this); }
  open() { this.readyState = 1; this.onopen?.(); }
  close() { this.readyState = 3; this.onclose?.(); }
  emit(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) }); }
}
const account = { provider: "Polymarket", accountId: 285,
  token: JSON.stringify({ apiKey: "test-key", secret: "test-secret", passphrase: "test-pass" }) } as never;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
  vi.clearAllMocks();
  Socket.instances = [];
  vi.stubGlobal("WebSocket", Socket);
  mocks.order.mockResolvedValue(null);
  mocks.trade.mockResolvedValue(null);
  resetPmUserWsSourceModeForTests("changmen");
});
afterEach(() => { stopAllPolymarketUserWs(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("delayed confirmation with real WS watcher and settlement coordinator", () => {
  it.each([0, 1])("does not claim a sole FAILED when WS already knows two tradeIds (poll attempts: %s)", async (maxAttempts) => {
    registerPolymarketOrderWatch(account, "multiple-trades", { conditionId: "market" });
    const socket = Socket.instances[0]!;
    socket.open();
    socket.emit({ event_type: "order", type: "PLACEMENT", id: "multiple-trades", size_matched: "0",
      associate_trades: ["trade-1", "trade-2"] });
    expect(readPolymarketOrderWatch("multiple-trades", account)).toBeNull();
    mocks.trade.mockResolvedValue({ id: "trade-1", status: "FAILED", side: "BUY", taker_order_id: "multiple-trades" });
    const job = settlePolymarketDelayedOrder(account, "multiple-trades", {
      poll: { initialDelayMs: 0, maxAttempts }, tradeConfirm: { maxRetries: 1 },
      fokGrace: { graceMs: 0, postCancelAttempts: 0 },
    });
    await vi.advanceTimersByTimeAsync(1);
    expect(await job).toMatchObject({ outcome: "timeout" });
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it.each(["changmen", "official"] as const)("rejects immediately on official FAILED via %s while REST hangs", async (mode) => {
    resetPmUserWsSourceModeForTests(mode);
    registerPolymarketOrderWatch(account, "failed-now", { conditionId: "market" });
    const socket = Socket.instances[0]!;
    socket.open();
    mocks.order.mockImplementation(() => new Promise(() => {}));
    mocks.trade.mockImplementation(() => new Promise(() => {}));
    const job = settlePolymarketDelayedOrder(account, "failed-now", { poll: { initialDelayMs: 30_000 } });
    socket.emit({ event_type: "trade", type: "TRADE", id: "failed-trade", side: "BUY",
      status: "FAILED", taker_order_id: "failed-now", size: "10" });
    await vi.advanceTimersByTimeAsync(1);
    expect(await job).toMatchObject({ outcome: "unfilled", row: { status: "FAILED", confirmationBasis: "trade_failed" } });
    expect(Date.now()).toBe(100_001);
    expect(mocks.order).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.trace).toHaveBeenCalledWith(285, "failed-now", "decision",
      expect.objectContaining({ outcome: "unfilled", interpretation: "trade_failed" }));
  });

  it("keeps MATCHED terminal and ignores subsequent FAILED", async () => {
    registerPolymarketOrderWatch(account, "cached-failure", { conditionId: "market" });
    const socket = Socket.instances[0]!;
    socket.open();
    const msg = { event_type: "trade", type: "TRADE", id: "trade-1", side: "BUY",
      taker_order_id: "cached-failure", size: "10" };
    socket.emit({ ...msg, status: "MATCHED" });
    socket.emit({ ...msg, status: "FAILED" });
    const job = settlePolymarketDelayedOrder(account, "cached-failure");
    await vi.advanceTimersByTimeAsync(1);
    expect(await job).toMatchObject({ outcome: "matched", row: { status: "MATCHED" } });
    expect(readPolymarketOrderWatch("cached-failure", account)).toBeNull();
  });

  it("recognizes FAILED during ongoing verification after the first WS timeout", async () => {
    registerPolymarketOrderWatch(account, "late-failure", { conditionId: "market", timeoutMs: 100 });
    const socket = Socket.instances[0]!;
    socket.open();
    const job = settlePolymarketDelayedOrder(account, "late-failure", { poll: { initialDelayMs: 30_000 } });
    await vi.advanceTimersByTimeAsync(200);
    socket.emit({ event_type: "trade", type: "TRADE", id: "trade-1", side: "BUY",
      status: "TRADE_STATUS_FAILED", taker_order_id: "late-failure" });
    await vi.advanceTimersByTimeAsync(1);
    expect(await job).toMatchObject({ outcome: "unfilled", row: { confirmationBasis: "trade_failed" } });
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it("receives a late zero-fill cancellation after the first watch timeout", async () => {
    registerPolymarketOrderWatch(account, "late", { conditionId: "market", timeoutMs: 100 });
    const socket = Socket.instances[0]!;
    socket.open();
    const job = settlePolymarketDelayedOrder(account, "late", { submittedAt: Date.now() });
    await vi.advanceTimersByTimeAsync(200);
    socket.emit({ event_type: "order", type: "CANCELLATION", id: "late", size_matched: "0" });
    await vi.advanceTimersByTimeAsync(1);
    expect((await job).outcome).toBe("unfilled");
    expect(Date.now()).toBe(100_201);
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.trace).toHaveBeenCalledWith(285, "late", "ws_timeout");
    expect(mocks.trace).toHaveBeenCalledWith(285, "late", "decision", expect.objectContaining({ outcome: "unfilled" }));
  });

  it.each([false, true])("handles cancellation during trade retries after WS timeout (competing fill: %s)", async (competingFill) => {
    registerPolymarketOrderWatch(account, "trade-retry", { conditionId: "market", timeoutMs: 100 });
    const socket = Socket.instances[0]!;
    socket.open();
    let finished = false;
    const job = settlePolymarketDelayedOrder(account, "trade-retry", {
      poll: { initialDelayMs: 200, maxAttempts: 1 },
      tradeConfirm: { maxRetries: 8, retryMs: 2_000 },
    }).then(result => { finished = true; return result; });
    await vi.advanceTimersByTimeAsync(500);
    expect(finished).toBe(false);
    if (competingFill)
      mocks.order.mockResolvedValue({ status: "MATCHED", size_matched: "10" });
    socket.emit({ event_type: "order", type: "CANCELLATION", id: "trade-retry", size_matched: "0" });
    await vi.advanceTimersByTimeAsync(1);
    expect(finished).toBe(true);
    expect((await job).outcome).toBe(competingFill ? "matched" : "unfilled");
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it("reconciles a fill over REST while WS is disconnected", async () => {
    registerPolymarketOrderWatch(account, "offline", { conditionId: "market" });
    Socket.instances[0]!.open();
    Socket.instances[0]!.close();
    mocks.trade.mockResolvedValue({ id: "trade", status: "CONFIRMED", size: "10" });
    const job = settlePolymarketDelayedOrder(account, "offline", { submittedAt: Date.now() });
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await job).outcome).toBe("matched");
    expect(mocks.trace).toHaveBeenCalledWith(285, "offline", "ws_close");
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it("resubscribes the original order's market after reconnecting", async () => {
    registerPolymarketOrderWatch(account, "reconnect", { conditionId: "market" });
    Socket.instances[0]!.open();
    Socket.instances[0]!.close();
    const job = settlePolymarketDelayedOrder(account, "reconnect");
    await vi.advanceTimersByTimeAsync(5_000);
    const socket = Socket.instances[1]!;
    socket.open();
    expect(JSON.parse(socket.send.mock.calls[0]![0])).toMatchObject({ type: "user", markets: [] });
    socket.emit({ event_type: "order", type: "UPDATE", id: "reconnect", size_matched: "10", original_size: "10" });
    await vi.advanceTimersByTimeAsync(1);
    expect((await job).outcome).toBe("matched");
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it("reconciles immediately on reconnect without waiting for a long polling interval", async () => {
    registerPolymarketOrderWatch(account, "recovery", { conditionId: "market", timeoutMs: 100 });
    Socket.instances[0]!.open();
    Socket.instances[0]!.close();
    const job = settlePolymarketDelayedOrder(account, "recovery", {
      poll: { initialDelayMs: 30_000 },
    });
    await vi.advanceTimersByTimeAsync(5_000);
    mocks.trade.mockResolvedValue({ id: "missed", status: "CONFIRMED", size: "10" });
    Socket.instances[1]!.open();
    await vi.advanceTimersByTimeAsync(1);
    expect((await job).outcome).toBe("matched");
    expect(mocks.order).toHaveBeenCalled();
    expect(mocks.trade).toHaveBeenCalled();
    const count = mocks.trade.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.trade.mock.calls.length).toBe(count);
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
});
