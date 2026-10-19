import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { awaitPolymarketOrderWatch, readPolymarketOrderWatch, registerPolymarketOrderWatch, stopAllPolymarketUserWs, warmPolymarketUserWs } from "@changmen/venue-browser/polymarket/realtime/userWs";
import { settlePolymarketDelayedOrder } from "@changmen/venue-browser/polymarket/fok/orderSettlement";

const reads = vi.hoisted(() => ({ order: vi.fn(), trade: vi.fn() }));
vi.mock("@changmen/client-core/bridge/clientApi", () => ({ saveUserLog: vi.fn(async () => {}) }));
vi.mock("@changmen/venue-browser/polymarket/orders/history/orders", () => ({ fetchPolymarketConfirmedTradeForOrder: reads.trade }));
vi.mock("@changmen/venue-browser/polymarket/orders/facts/orderStatus", async (original) => ({
  ...await original<typeof import("@changmen/venue-browser/polymarket/orders/facts/orderStatus")>(), fetchPolymarketOrderRow: reads.order,
}));

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { Socket.instances.push(this); }
  send() {}
  close() {}
  receive(message: unknown) { this.onmessage?.({ data: JSON.stringify(message) }); }
}
const account = { provider: "Polymarket", accountId: 292,
  token: JSON.stringify({ apiKey: "test-key", secret: "test-secret", passphrase: "test-pass" }) } as PlatformAccount;
const cancel = (fields: Record<string, unknown> = {}) => ({ event_type: "order", type: "CANCELLATION", id: "order-1", ...fields });
const fill = { event_type: "order", type: "UPDATE", id: "order-1", original_size: "5", size_matched: "5" };
function watch(submittedOrderType?: "FOK" | "GTC" | "GTD" | "FAK") {
  registerPolymarketOrderWatch(account, "order-1", { conditionId: "market", submittedOrderType });
  return Socket.instances[0]!;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", Socket);
  Socket.instances = [];
  reads.order.mockReset().mockResolvedValue(null);
  reads.trade.mockReset().mockResolvedValue(null);
});
afterEach(() => {
  stopAllPolymarketUserWs();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("FOK official cancellation", () => {
  it.each([{}, { size_matched: null }, { size_matched: "" }, { size_matched: "NaN" }, { size_matched: 0 }, { size_matched: "0.0000" }])(
    "finishes immediately without REST for quantity %j", async fields => {
      const socket = watch("FOK");
      const started = Date.now();
      const settlement = settlePolymarketDelayedOrder(account, "order-1", { poll: { initialDelayMs: 30_000 } });
      socket.receive(cancel(fields));
      await expect(settlement).resolves.toMatchObject({ outcome: "unfilled", row: { status: "cancelled", size_matched: "0" } });
      expect(Date.now()).toBe(started);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(reads.order).not.toHaveBeenCalled();
      expect(reads.trade).not.toHaveBeenCalled();
    });
  it.each(["GTC", "GTD", "FAK", undefined] as const)("does not enable the shortcut for %s, even with FOK in the wire event", mode => {
    watch(mode).receive(cancel({ order_type: "FOK" }));
    expect(readPolymarketOrderWatch("order-1", account)).toBeNull();
  });
  it("does not wait for an already running REST read when FOK cancellation arrives", async () => {
    reads.order.mockImplementation(() => new Promise(() => {}));
    reads.trade.mockImplementation(() => new Promise(() => {}));
    const socket = watch("FOK");
    const settlement = settlePolymarketDelayedOrder(account, "order-1", { poll: { initialDelayMs: 0 } });
    await vi.advanceTimersByTimeAsync(0);
    expect(reads.order).toHaveBeenCalledTimes(1);
    const received = Date.now();
    socket.receive(cancel());
    await expect(settlement).resolves.toMatchObject({ outcome: "unfilled" });
    expect(Date.now()).toBe(received);
  });
  it.each(["GTC", undefined] as const)("retains zero cancellation reconciliation for %s", async mode => {
    const socket = watch(mode);
    const settlement = settlePolymarketDelayedOrder(account, "order-1", { poll: { initialDelayMs: 30_000 } });
    socket.receive(cancel({ size_matched: "0" }));
    await expect(settlement).resolves.toMatchObject({ outcome: "unfilled" });
    expect(reads.order).toHaveBeenCalled();
    expect(reads.trade).toHaveBeenCalled();
  });
  it.each([
    { order_type: "GTC" }, { associate_trades: ["trade-1"] }, { associate_trades: "invalid-list" },
    { status: "MATCHED" }, { id: "other-order" }, { event_type: "trade" },
  ])("keeps contradictory or unrelated cancellation pending: %j", fields => {
    watch("FOK").receive(cancel(fields));
    expect(readPolymarketOrderWatch("order-1", account)).toBeNull();
  });
  it.each(["UPDATE", "PLACEMENT"])("does not infer rejection from %s with canceled status", type => {
    watch("FOK").receive(cancel({ type, status: "CANCELED" }));
    expect(readPolymarketOrderWatch("order-1", account)).toBeNull();
  });
  it("preserves a positive quantity in the cancellation itself", async () => {
    watch("FOK").receive(cancel({ size_matched: "5" }));
    await expect(awaitPolymarketOrderWatch("order-1", account)).resolves.toMatchObject({ outcome: "matched" });
  });
  it.each([false, true])("preserves fill evidence before cancellation (same batch: %s)", async batch => {
    const socket = watch("FOK");
    if (batch) socket.receive([cancel(), fill]);
    else { socket.receive(fill); socket.receive(cancel()); }
    await expect(awaitPolymarketOrderWatch("order-1", account)).resolves.toMatchObject({ outcome: "matched" });
  });
  it("keeps historical trade associations when a later cancellation omits them", () => {
    const socket = watch("FOK");
    socket.receive({ event_type: "order", type: "UPDATE", id: "order-1", associate_trades: ["trade-1"] });
    socket.receive(cancel({ size_matched: "0" }));
    expect(readPolymarketOrderWatch("order-1", account)).toBeNull();
  });
  it("keeps a historical MATCHED status with missing quantity for reconciliation", () => {
    const socket = watch("FOK");
    socket.receive({ event_type: "order", type: "UPDATE", id: "order-1", status: "MATCHED" });
    socket.receive(cancel());
    expect(readPolymarketOrderWatch("order-1", account)).toBeNull();
  });
  it.each([false, true])("replays pre-ACK cancellation with the actual submit mode (cached fill: %s)", async cachedFill => {
    warmPolymarketUserWs(account);
    const socket = Socket.instances[0]!;
    socket.receive(cancel());
    if (cachedFill) socket.receive(fill);
    watch("FOK");
    await expect(awaitPolymarketOrderWatch("order-1", account)).resolves.toMatchObject({ outcome: cachedFill ? "matched" : "unfilled" });
  });
  it("ignores cancellation on another authenticated account", () => {
    watch("FOK");
    warmPolymarketUserWs({ ...account, token: JSON.stringify({ apiKey: "other", secret: "s", passphrase: "p" }) });
    Socket.instances[1]!.receive(cancel());
    expect(readPolymarketOrderWatch("order-1", account)).toBeNull();
  });
  it("does not relabel an existing GTC watch on repeated registration", () => {
    const socket = watch("GTC");
    watch("FOK");
    socket.receive(cancel());
    expect(readPolymarketOrderWatch("order-1", account)).toBeNull();
  });
});
