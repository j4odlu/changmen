import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { readPolymarketTrades } from "../../../../polymarket/orders/facts/tradeReader";
import { fetchPolymarketConfirmedTradeForOrder } from "../../../../polymarket/orders/confirmation/tradeLookup";
import type { PolymarketTradeRow } from "../../../../polymarket/orders/history/orderTradeTypes";

const getTrades = vi.hoisted(() => vi.fn());
vi.mock("@changmen/venue-browser/polymarket/orders/pmClientApi", () => ({ pmGetTrades: getTrades }));
const wallet = "0x" + "a".repeat(40), opponent = "0x" + "b".repeat(40);
const account = Object.freeze({ provider: "Polymarket", accountId: 1, gateway: "https://custom.invalid", token: JSON.stringify({ walletAddress: wallet }) }) as PlatformAccount;
function trade(overrides: PolymarketTradeRow = {}): PolymarketTradeRow {
  return { id: "trade-1", taker_order_id: "order-1", market: "condition", asset_id: "101", side: "BUY", status: "CONFIRMED", size: "10", price: ".4", ...overrides };
}
beforeEach(() => { getTrades.mockReset(); vi.spyOn(Date, "now").mockReturnValue(1793894400123); });
afterEach(() => vi.restoreAllMocks());

describe("shared private trade reader", () => {
  it("keeps the original account, seconds cursor and five-page cap without mutating rows", async () => {
    const rows = Object.freeze([Object.freeze(trade())]); getTrades.mockResolvedValue(rows);
    expect(await readPolymarketTrades(account, 123, true)).toBe(rows);
    expect(getTrades).toHaveBeenCalledExactlyOnceWith(account, 123, 5);
  });
  it("preserves the original upstream error for strict confirmation", async () => {
    const error = new Error("HTTP 401"); getTrades.mockRejectedValue(error);
    await expect(readPolymarketTrades(account, 123, true)).rejects.toBe(error);
    expect(await readPolymarketTrades(account, 123)).toEqual([]);
  });
  it.each([undefined, null, { data: [] }, "invalid"])("does not turn malformed strict response %j into no fills", async response => {
    getTrades.mockResolvedValue(response);
    await expect(readPolymarketTrades(account, 123, true)).rejects.toThrow("PM 成交查询返回非列表响应");
    expect(await readPolymarketTrades(account, 123)).toEqual([]);
  });
});

describe("exact order trade lookup", () => {
  it("does not read private trades for an empty order ID", async () => {
    expect(await fetchPolymarketConfirmedTradeForOrder(account, " ")).toBeNull();
    expect(getTrades).not.toHaveBeenCalled();
  });
  it("uses the requested window and returns the first accepted exact-order BUY row", async () => {
    const first = trade({ size: "2.345678" });
    const rows = Object.freeze([Object.freeze(trade({ taker_order_id: "other" })), Object.freeze(trade({ status: "FAILED" })),
      Object.freeze(trade({ side: "SELL" })), Object.freeze(first), Object.freeze(trade({ id: "trade-2", size: "20" }))]);
    getTrades.mockResolvedValue(rows);
    expect(await fetchPolymarketConfirmedTradeForOrder(account, " ORDER-1 ", 12345, "BUY", true)).toBe(first);
    expect(getTrades).toHaveBeenCalledExactlyOnceWith(account, Math.floor((1793894400123 - 12345) / 1000), 5);
    // This query selects evidence; aggregating all fills is a separate operation.
    expect(first.size).toBe("2.345678");
  });
  it.each(["CONFIRMED", "MATCHED", "MINED", "RETRYING"])("retains the existing accepted status %s", async status => {
    const row = trade({ status }); getTrades.mockResolvedValue([row]);
    expect(await fetchPolymarketConfirmedTradeForOrder(account, "order-1")).toBe(row);
  });
  it("filters maker legs by account ownership and uses the leg's SELL amount and asset", async () => {
    getTrades.mockResolvedValue([trade({ trader_side: "MAKER", maker_orders: [
      { order_id: "order-1", maker_address: opponent, matched_amount: "100" },
      { order_id: "order-1", maker_address: wallet.toUpperCase(), matched_amount: "2.345678", price: ".6", side: "SELL", asset_id: "202" },
    ] })]);
    expect(await fetchPolymarketConfirmedTradeForOrder(account, "order-1", 600000, "SELL", true))
      .toMatchObject({ taker_order_id: "order-1", side: "SELL", size: "2.345678", price: ".6", asset_id: "202" });
    expect(await fetchPolymarketConfirmedTradeForOrder(account, "order-1", 600000, "BUY", true)).toBeNull();
  });
  it("propagates strict read failures and keeps ordinary lookup's existing null behavior", async () => {
    const error = new Error("network unavailable"); getTrades.mockRejectedValue(error);
    await expect(fetchPolymarketConfirmedTradeForOrder(account, "order-1", 600000, "BUY", true)).rejects.toBe(error);
    expect(await fetchPolymarketConfirmedTradeForOrder(account, "order-1")).toBeNull();
  });
  it("does not reinterpret read failure as a confirmed or failed trade", async () => {
    getTrades.mockResolvedValue({ error: "invalid" });
    await expect(fetchPolymarketConfirmedTradeForOrder(account, "order-1", 600000, "BUY", true, true))
      .rejects.toThrow("非列表响应");
    expect(await fetchPolymarketConfirmedTradeForOrder(account, "order-1", 600000, "BUY", false, true)).toBeNull();
  });
});
