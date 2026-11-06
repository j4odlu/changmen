import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
const mocks = vi.hoisted(() => ({ order: vi.fn(), trade: vi.fn(), mark: vi.fn(), attempt: undefined as unknown }));
vi.mock("@changmen/venue-browser/polymarket/orders/pmClientApi", async original => ({
  ...await original<typeof import("@changmen/venue-browser/polymarket/orders/pmClientApi")>(), pmGetOrder: mocks.order, pmGetTradesById: mocks.trade,
}));
vi.mock("@changmen/venue-browser/polymarket/orders/positions/pmOrigin", () => ({ markPolymarketChangmenOrder: mocks.mark }));
vi.mock("@changmen/venue-browser/polymarket/submission/recovery/pmSubmitJournal", async original => ({
  ...await original<typeof import("@changmen/venue-browser/polymarket/submission/recovery/pmSubmitJournal")>(),
  pmSubmitAttemptForOrder: () => mocks.attempt, pmNormalizedSubmitEvidence: (attempt: { evidence?: unknown } | undefined) => attempt?.evidence,
}));
vi.mock("@changmen/venue-browser/polymarket/orders/confirmation/marketDelay", () => ({
  UNKNOWN_SPORTS_SECONDS_DELAY: 0, fetchPolymarketMarketSecondsDelay: async () => ({ secondsDelay: 0, fromMarket: true }),
  buildPolymarketDelayedPollOpts: () => ({ initialDelayMs: 0, intervalMs: 1, maxAttempts: 2 }), buildPolymarketWatchTimeoutMs: () => 1000,
}));
vi.mock("@changmen/venue-browser/polymarket/fok/settlementJob", () => ({ startPolymarketSettlementJob: vi.fn(),
  awaitPolymarketSettlementJob: async () => ({ outcome: "matched", row: { status: "MATCHED", size_matched: "10" } }),
}));
vi.mock("@changmen/venue-browser/polymarket/realtime/userWs", () => ({ registerPolymarketOrderWatch: vi.fn() }));
import { awaitPolymarketManualSellFinalOutcome } from "../../../../polymarket/submission/pmManualSell";
const account = { accountId: 9, provider: "Polymarket", token: "{}" } as PlatformAccount;
const buy = { provider: "Polymarket", orderId: "buy", pmTokenId: "101", pmConditionId: "condition", pmSide: "buy", pmShares: 10,
  pmFillPrice: .5, pmStakeUsdc: 5, pmSellState: "open", odds: 2, createAt: 1, betMoney: 33.5, reward: 67, money: 0, status: "none",
  game: "", match: "", bet: "", item: "" } as const;
const rows = [
  { id: "trade-1", market: "condition", asset_id: "101", taker_order_id: "sell", side: "SELL", size: "4", price: ".4", status: "CONFIRMED" },
  { id: "trade-2", market: "condition", asset_id: "101", taker_order_id: "sell", side: "SELL", size: "6", price: ".6", status: "CONFIRMED" },
];
beforeEach(() => {
  vi.useFakeTimers(); mocks.mark.mockClear(); mocks.attempt = undefined;
  mocks.order.mockReset().mockResolvedValue({ id: "sell", market: "condition", asset_id: "101", side: "SELL", original_size: "10", size_matched: "10", status: "MATCHED", associate_trades: ["trade-1", "trade-2"] });
  mocks.trade.mockReset().mockImplementation(async (_account, id) => rows.filter(row => row.id === id));
});
afterEach(() => { expect(vi.getTimerCount()).toBe(0); vi.useRealTimers(); });

it("uses the actual cumulative executions to build both sell and buy accounting patches", async () => {
  const result = await awaitPolymarketManualSellFinalOutcome({ account, buyRow: buy, sellOrderId: "sell", fallbackPrice: .3 });
  expect(result).toMatchObject({ outcome: "filled", sharesSold: 10, proceedsUsdc: 5.2, partialFill: false });
  if (result.outcome === "filled") expect(result.ordersToSave.find(row => row.orderId === "buy"))
    .toMatchObject({ pmSellProceeds: 5.2, pmRealizedPnlUsdc: .2, pmAttributedSellShares: 10, pmSellState: "closed" });
  expect(mocks.mark).toHaveBeenCalledOnce();
});
it("keeps missing trade cash pending without patches and later reconciles the same original sell", async () => {
  mocks.trade.mockImplementation(async (_account, id) => id === "trade-2" ? [] : [rows[0]]);
  const pending = awaitPolymarketManualSellFinalOutcome({ account, buyRow: buy, sellOrderId: "sell", fallbackPrice: .9 });
  await vi.runAllTimersAsync();
  expect(await pending).toMatchObject({ outcome: "pending", sellOrderId: "sell" });
  expect(await pending).not.toHaveProperty("ordersToSave"); expect(mocks.mark).not.toHaveBeenCalled();
  mocks.trade.mockImplementation(async (_account, id) => rows.filter(row => row.id === id));
  expect(await awaitPolymarketManualSellFinalOutcome({ account, buyRow: buy, sellOrderId: "sell" }))
    .toMatchObject({ outcome: "filled", sharesSold: 10, proceedsUsdc: 5.2 });
});
it("does not treat an older recovered single-trade snapshot as the complete sale", async () => {
  mocks.attempt = { state: "accepted", evidence: { quantityUnit: "shares", row: { status: "MATCHED", size_matched: "4" }, trade: { size: "4", price: ".4" } } };
  expect(await awaitPolymarketManualSellFinalOutcome({ account, buyRow: buy, sellOrderId: "sell" }))
    .toMatchObject({ outcome: "filled", sharesSold: 10, proceedsUsdc: 5.2 });
  expect(mocks.trade).toHaveBeenCalledTimes(2);
});
