import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { POLYMARKET_SELL_FILL_RETRY_OPTS, resolvePolymarketBuyFill, resolvePolymarketSellFill, resolvePolymarketSellFillWithRetry } from "../../../../polymarket/orders/confirmation/fillResolution";
const reads = vi.hoisted(() => ({ order: vi.fn(), trades: vi.fn() }));
const getTrades = reads.trades;
vi.mock("@changmen/venue-browser/polymarket/orders/pmClientApi", () => ({ pmGetOrder: reads.order, pmGetTradesById: reads.trades }));
const account = Object.freeze({ accountId: 1, provider: "Polymarket", token: "{}" }) as PlatformAccount;
const sellTrade = { id: "trade-1", taker_order_id: "order-1", market: "condition", asset_id: "101", side: "SELL", status: "CONFIRMED", size: "2.345678", price: ".7" };
beforeEach(() => {
  getTrades.mockReset().mockResolvedValue([]);
  reads.order.mockReset().mockResolvedValue({ id: "order-1", market: "condition", asset_id: "101", side: "SELL", status: "MATCHED", size_matched: "2.345678", original_size: "2.345678", associate_trades: ["trade-1"] });
  vi.useFakeTimers(); vi.setSystemTime(1793894400123);
});
afterEach(() => { expect(vi.getTimerCount()).toBe(0); vi.useRealTimers(); });

describe("POST priority and trade fallback", () => {
  it("uses BUY POST micro amounts directly without a read", async () => {
    expect(await resolvePolymarketBuyFill(account, "order-1", Object.freeze({ makingAmount: "1", takingAmount: "3" })))
      .toEqual({ stakeUsdc: .000001, shares: .000003 });
    expect(getTrades).not.toHaveBeenCalled();
  });
  it("uses reversed SELL POST micro units without reads or retry timers", async () => {
    const response = Object.freeze({ makingAmount: "2345678", takingAmount: "1642000" });
    expect(await resolvePolymarketSellFill(account, "order-1", response)).toEqual({ proceedsUsdc: 1.642, sharesSold: 2.345678 });
    expect(await resolvePolymarketSellFillWithRetry(account, "order-1", response)).toEqual({ proceedsUsdc: 1.642, sharesSold: 2.345678 });
    expect(getTrades).not.toHaveBeenCalled();
  });
  it("uses normalized GET fills when the BUY receipt is incomplete", async () => {
    reads.order.mockResolvedValue({ id: "order-1", market: "condition", asset_id: "101", side: "BUY", status: "MATCHED", size_matched: "1000000.123456", original_size: "1000000.123456", associate_trades: ["trade-1"] });
    getTrades.mockResolvedValue([{ ...sellTrade, side: "BUY", size: "1000000.123456", price: ".4" }]);
    expect(await resolvePolymarketBuyFill(account, "order-1", { makingAmount: "1" }, 30000))
      .toEqual({ stakeUsdc: 400000.0494, shares: 1000000.123456 });
    expect(getTrades).toHaveBeenCalledExactlyOnceWith(account, "trade-1");
  });
  it("uses precise SELL shares and rounds only the cash amount", async () => {
    getTrades.mockResolvedValue([sellTrade]);
    expect(await resolvePolymarketSellFill(account, "order-1", {})).toEqual({ proceedsUsdc: 1.642, sharesSold: 2.345678 });
  });
  it("preserves partial POST facts when ordinary trade reads fail", async () => {
    getTrades.mockRejectedValue(Error("offline"));
    expect(await resolvePolymarketBuyFill(account, "order-1", { makingAmount: "1000000" })).toEqual({ stakeUsdc: 1, shares: 0 });
    expect(await resolvePolymarketSellFill(account, "order-1", { makingAmount: "2000000" })).toEqual({ proceedsUsdc: 0, sharesSold: 2 });
  });
});

describe("delayed SELL amount lookup", () => {
  it("retains the existing defaults", () => {
    expect(POLYMARKET_SELL_FILL_RETRY_OPTS).toEqual({ lookbackMs: 600000, retryMs: 2000, maxRetries: 15 });
  });
  it("waits only between attempts, accepts a later fill and stops immediately", async () => {
    getTrades.mockResolvedValueOnce([]).mockResolvedValueOnce([sellTrade]);
    const result = resolvePolymarketSellFillWithRetry(account, "order-1", {}, { retryMs: 2000, maxRetries: 3, lookbackMs: 30000 });
    await vi.advanceTimersByTimeAsync(1999);
    expect(getTrades).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual({ proceedsUsdc: 1.642, sharesSold: 2.345678 });
    expect(getTrades).toHaveBeenCalledTimes(2);
    expect(Date.now()).toBe(1793894402123);
  });
  it("exhausts exactly the configured attempts without pairing partial cash with an unverified quantity", async () => {
    getTrades.mockRejectedValueOnce(Error("offline")).mockResolvedValue([]);
    const result = resolvePolymarketSellFillWithRetry(account, "order-1", { takingAmount: "1000000" },
      { retryMs: 50, maxRetries: 3, orderRow: Object.freeze({ size_matched: "1000000.123456" }) });
    await vi.advanceTimersByTimeAsync(100);
    expect(await result).toEqual({ proceedsUsdc: 1, sharesSold: 0 });
    expect(getTrades).toHaveBeenCalledTimes(3);
  });
  it("does not invent proceeds when the order row only confirms shares", async () => {
    const result = resolvePolymarketSellFillWithRetry(account, "order-1", {}, { retryMs: 1, maxRetries: 2, orderRow: { size_matched: "5" } });
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual({ proceedsUsdc: 0, sharesSold: 5 });
    expect(getTrades).toHaveBeenCalledTimes(2);
  });
  it("keeps explicit zero retries and partial POST shares without any request", async () => {
    expect(await resolvePolymarketSellFillWithRetry(account, "order-1", { makingAmount: "3000000" }, { maxRetries: 0 }))
      .toEqual({ proceedsUsdc: 0, sharesSold: 3 });
    expect(getTrades).not.toHaveBeenCalled();
  });
  it("does not count FAILED trades or zero-price rows as valid cash fills", async () => {
    getTrades.mockResolvedValueOnce([{ ...sellTrade, status: "FAILED" }]).mockResolvedValueOnce([{ ...sellTrade, price: "0" }]);
    const result = resolvePolymarketSellFillWithRetry(account, "order-1", null, { maxRetries: 2, retryMs: 1 });
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual({ proceedsUsdc: 0, sharesSold: 0 });
  });
});
