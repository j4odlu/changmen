import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { resolvePolymarketBuyFill, resolvePolymarketSellFill, resolvePolymarketSellFillWithRetry } from "../../../../polymarket/orders/confirmation/fillResolution";
import { polymarketOrderFillTotals, type PolymarketFillOrderSnapshot } from "../../../../polymarket/orders/facts/orderFillTotals";
import { readPolymarketOrderFillAmounts } from "../../../../polymarket/orders/confirmation/orderFillReader";
import type { PolymarketTradeRow } from "../../../../polymarket/orders/history/orderTradeTypes";
const reads = vi.hoisted(() => ({ trades: vi.fn(), order: vi.fn(), byId: vi.fn() }));
vi.mock("@changmen/venue-browser/polymarket/orders/pmClientApi", () => ({ pmGetTrades: reads.trades, pmGetOrder: reads.order, pmGetTradesById: reads.byId }));
const account = { accountId: 1, provider: "Polymarket", token: "{}" } as PlatformAccount;
beforeEach(() => { vi.resetAllMocks(); });
afterEach(() => vi.restoreAllMocks());
function snapshots() {
  const order: PolymarketFillOrderSnapshot = { id: "order-1", side: "SELL", market: "condition", asset_id: "101", size_matched: "10", original_size: "10", status: "MATCHED", associate_trades: ["trade-1", "trade-2"] };
  const rows: PolymarketTradeRow[] = [
    { id: "trade-1", taker_order_id: "order-1", side: "SELL", market: "condition", asset_id: "101", size: "4", price: ".4", status: "CONFIRMED" },
    { id: "trade-2", taker_order_id: "order-1", side: "SELL", market: "condition", asset_id: "101", size: "6", price: ".6", status: "CONFIRMED" },
  ];
  return { order, rows };
}
function wire(order: PolymarketFillOrderSnapshot, rows: PolymarketTradeRow[]) {
  reads.order.mockResolvedValue(order);
  reads.byId.mockImplementation(async (_account, id) => rows.filter(row => row.id === id));
}
it.each(["BUY", "SELL"] as const)("%s amount fallback accounts for all executions, not just the first trade", async side => {
  const rows = [
    { id: "trade-1", taker_order_id: "order-1", side, market: "condition", asset_id: "101", size: "4", price: ".4", status: "CONFIRMED" },
    { id: "trade-2", taker_order_id: "order-1", side, market: "condition", asset_id: "101", size: "6", price: ".6", status: "CONFIRMED" },
  ];
  reads.order.mockResolvedValue({ id: "order-1", side, market: "condition", asset_id: "101", size_matched: "10", original_size: "10", status: "MATCHED", associate_trades: rows.map(row => row.id) });
  reads.trades.mockResolvedValue(rows);
  reads.byId.mockImplementation(async (_account, id) => rows.filter(row => row.id === id));
  expect(await (side === "BUY" ? resolvePolymarketBuyFill(account, "order-1", {}) : resolvePolymarketSellFill(account, "order-1", {})))
    .toEqual(side === "BUY" ? { shares: 10, stakeUsdc: 5.2 } : { sharesSold: 10, proceedsUsdc: 5.2 });
});

it("deduplicates repeated executions without rounding each trade or changing inputs", () => {
  const { order, rows } = snapshots();
  Object.freeze(order.associate_trades); Object.freeze(order); rows.forEach(Object.freeze); Object.freeze(rows);
  expect(polymarketOrderFillTotals(order, [...rows, ...rows], " ORDER-1 ", "SELL")).toEqual({ shares: 10, usdc: 5.2 });
  const tiny = rows.map(row => ({ ...row, size: ".0124", price: ".4" }));
  expect(polymarketOrderFillTotals({ ...order, size_matched: ".0248", original_size: ".0248" }, tiny, "order-1", "SELL"))
    .toEqual({ shares: .0248, usdc: .0099 });
});
it("sums distinct buckets with one trade ID and rejects conflicting repeats", () => {
  const { order, rows } = snapshots();
  const buckets = [rows[0], { ...rows[1], id: "trade-1", bucket_index: 1 }];
  expect(polymarketOrderFillTotals({ ...order, associate_trades: ["trade-1"] }, buckets, "order-1", "SELL"))
    .toEqual({ shares: 10, usdc: 5.2 });
  expect(polymarketOrderFillTotals(order, [...rows, { ...rows[0], size: "5" }], "order-1", "SELL")).toBeNull();
  expect(polymarketOrderFillTotals(order, [...rows, { ...rows[0], status: "FAILED" }], "order-1", "SELL")).toBeNull();
});
it("uses only the exact maker order's shares, side, asset and price", () => {
  const { order, rows } = snapshots();
  const makers = rows.map(row => ({ ...row, taker_order_id: "opponent", asset_id: "202", side: "BUY", maker_orders: [
    { order_id: "ORDER-1", asset_id: "101", side: "SELL", matched_amount: row.size, price: row.price },
    { order_id: "other-maker", asset_id: "101", side: "SELL", matched_amount: "10000", price: ".9" },
  ] }));
  expect(polymarketOrderFillTotals(order, makers, "order-1", "SELL")).toEqual({ shares: 10, usdc: 5.2 });
});
it.each(["101", "201"])("binds complete amounts to the original protocol asset %s", asset => {
  const { order, rows } = snapshots();
  const selected = { ...order, asset_id: asset };
  const ownRows = rows.map(row => ({ ...row, asset_id: asset }));
  expect(polymarketOrderFillTotals(selected, ownRows, "order-1", "SELL")).toEqual({ shares: 10, usdc: 5.2 });
  expect(polymarketOrderFillTotals(selected, ownRows.map(row => ({ ...row, asset_id: "stale-token" })), "order-1", "SELL")).toBeNull();
});
it.each([
  { id: "other" }, { side: "BUY" }, { asset_id: "" }, { market: "" }, { status: "LIVE" },
  { size_matched: "11" }, { size_matched: "NaN" }, { original_size: "0" }, { original_size: "20" }, { associate_trades: [] },
  { original_size: "0xA" }, { size_matched: "1e1" },
])("rejects incomplete or inconsistent original order %j", patch => {
  const { order, rows } = snapshots();
  expect(polymarketOrderFillTotals({ ...order, ...patch }, rows, "order-1", "SELL")).toBeNull();
});
it.each([
  { id: "unrelated" }, { market: "other-condition" }, { asset_id: "202" }, { side: "BUY" },
  { size: "invalid" }, { size: "0" }, { price: "0" }, { price: "1" }, { status: "FAILED" }, { status: "PENDING" }, { bucket_index: -1 },
  { size: "0x4" }, { price: "4e-1" },
])("does not turn invalid trade %j into a partial cash total", patch => {
  const { order, rows } = snapshots();
  expect(polymarketOrderFillTotals(order, [{ ...rows[0], ...patch }, rows[1]], "order-1", "SELL")).toBeNull();
});
it("requires every linked trade and the previously observed share count", () => {
  const { order, rows } = snapshots();
  expect(polymarketOrderFillTotals(order, rows.slice(0, 1), "order-1", "SELL")).toBeNull();
  expect(polymarketOrderFillTotals(order, rows, "order-1", "SELL", 11)).toBeNull();
  expect(polymarketOrderFillTotals({ ...order, original_size: "20", status: "CANCELED_MARKET_RESOLVED" }, rows, "order-1", "SELL"))
    .toEqual({ shares: 10, usdc: 5.2 });
});
it("does not interpret malformed or unavailable exact trade reads as complete amounts", async () => {
  const { order, rows } = snapshots(); wire(order, rows);
  reads.byId.mockResolvedValueOnce({ data: rows });
  expect(await readPolymarketOrderFillAmounts(account, "order-1", "SELL")).toBeNull();
  reads.byId.mockRejectedValueOnce(Error("offline"));
  expect(await readPolymarketOrderFillAmounts(account, "order-1", "SELL")).toBeNull();
  expect(reads.trades).not.toHaveBeenCalled();
});
it("rereads the original order and rejects a changed quantity or linked trade set", async () => {
  const { order, rows } = snapshots(); wire(order, rows);
  reads.order.mockResolvedValueOnce(order).mockResolvedValueOnce({ ...order, associate_trades: ["trade-1", "trade-2", "late"] });
  expect(await readPolymarketOrderFillAmounts(account, "order-1", "SELL")).toBeNull();
  reads.order.mockResolvedValueOnce(order).mockResolvedValueOnce({ ...order, size_matched: "9" });
  expect(await readPolymarketOrderFillAmounts(account, "order-1", "SELL")).toBeNull();
});
it("reads all linked IDs beyond the historical five-page window with at most four concurrent reads", async () => {
  const { order, rows } = snapshots();
  const many = Array.from({ length: 11 }, (_, i) => ({ ...rows[0], id: `trade-${i}`, size: "1", price: ".5" }));
  reads.order.mockResolvedValue({ ...order, size_matched: "11", original_size: "11", associate_trades: many.map(row => row.id) });
  let active = 0, peak = 0;
  reads.byId.mockImplementation(async (_account, id) => { active++; peak = Math.max(peak, active); await Promise.resolve(); active--; return many.filter(row => row.id === id); });
  expect(await readPolymarketOrderFillAmounts(account, "order-1", "SELL")).toEqual({ shares: 11, usdc: 5.5 });
  expect(peak).toBeLessThanOrEqual(4); expect(reads.byId).toHaveBeenCalledTimes(11);
  expect(reads.trades).not.toHaveBeenCalled();
});
it("waits for the missing linked execution rather than returning the first indexed fill", async () => {
  vi.useFakeTimers();
  try {
    const { order, rows } = snapshots(); wire(order, rows);
    let secondReads = 0;
    reads.byId.mockImplementation(async (_account, id) => id === "trade-2" && secondReads++ === 0 ? [] : rows.filter(row => row.id === id));
    const result = resolvePolymarketSellFillWithRetry(account, "order-1", {}, { maxRetries: 2, retryMs: 2000, orderRow: { size_matched: "10" } });
    await vi.advanceTimersByTimeAsync(1999);
    expect(reads.byId).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual({ sharesSold: 10, proceedsUsdc: 5.2 });
    expect(reads.byId).toHaveBeenCalledTimes(4); expect(vi.getTimerCount()).toBe(0);
  }
  finally { vi.useRealTimers(); }
});
