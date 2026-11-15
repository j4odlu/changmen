import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
const mocks = vi.hoisted(() => ({ order: vi.fn(), trade: vi.fn(), activity: vi.fn(), mark: vi.fn(), attempt: undefined as unknown }));
vi.mock("@changmen/venue-browser/polymarket/orders/history/pmActivityV2", () => ({ fetchPolymarketActivityV2: mocks.activity }));
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
const wallet = `0x${"1".repeat(40)}`;
const account = { accountId: 9, provider: "Polymarket", token: JSON.stringify({ funder: wallet }) } as PlatformAccount;
const buy = { provider: "Polymarket", orderId: "buy", pmTokenId: "101", pmConditionId: "condition", pmSide: "buy", pmShares: 10,
  pmFillPrice: .5, pmStakeUsdc: 5, pmSellState: "open", odds: 2, createAt: 1, betMoney: 33.5, reward: 67, money: 0, status: "none",
  game: "", match: "", bet: "", item: "" } as const;
const tx1 = `0x${"a".repeat(64)}`, tx2 = `0x${"b".repeat(64)}`;
const rows = [
  { id: "trade-1", market: "condition", asset_id: "101", taker_order_id: "sell", side: "SELL", size: "4", price: ".4", status: "CONFIRMED" },
  { id: "trade-2", market: "condition", asset_id: "101", taker_order_id: "sell", side: "SELL", size: "6", price: ".6", status: "CONFIRMED" },
].map((row, index) => ({ ...row, transaction_hash: index ? tx2 : tx1, match_time: "1800000000" }));
const activity = () => [
  { type: "TRADE", side: "SELL", proxyWallet: wallet, conditionId: "condition", asset: "101", size: 4, price: .4, usdcSize: 1.56, transactionHash: tx1 },
  { type: "TRADE", side: "SELL", proxyWallet: wallet, conditionId: "condition", asset: "101", size: 6, price: .6, usdcSize: 3.52, transactionHash: tx2 },
];
beforeEach(() => {
  vi.useFakeTimers(); mocks.mark.mockClear(); mocks.attempt = undefined;
  mocks.order.mockReset().mockResolvedValue({ id: "sell", market: "condition", asset_id: "101", side: "SELL", original_size: "10", size_matched: "10", status: "MATCHED", associate_trades: ["trade-1", "trade-2"] });
  mocks.trade.mockReset().mockImplementation(async (_account, id) => rows.filter(row => row.id === id));
  mocks.activity.mockReset().mockResolvedValue(activity());
});
afterEach(() => { expect(vi.getTimerCount()).toBe(0); vi.useRealTimers(); });

it("uses the actual cumulative executions to build both sell and buy accounting patches", async () => {
  const result = await awaitPolymarketManualSellFinalOutcome({ account, buyRow: buy, sellOrderId: "sell", fallbackPrice: .3 });
  expect(result).toMatchObject({ outcome: "filled", sharesSold: 10, proceedsUsdc: 5.08, fillPrice: .52, partialFill: false });
  if (result.outcome === "filled") expect(result.ordersToSave.find(row => row.orderId === "buy"))
    .toMatchObject({ pmSellProceeds: 5.08, pmRealizedPnlUsdc: .08, pmAttributedSellShares: 10, pmSellState: "closed" });
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
    .toMatchObject({ outcome: "filled", sharesSold: 10, proceedsUsdc: 5.08 });
});
it("does not treat an older recovered single-trade snapshot as the complete sale", async () => {
  mocks.attempt = { state: "accepted", evidence: { quantityUnit: "shares", row: { status: "MATCHED", size_matched: "4" }, trade: { size: "4", price: ".4" } } };
  expect(await awaitPolymarketManualSellFinalOutcome({ account, buyRow: buy, sellOrderId: "sell" }))
    .toMatchObject({ outcome: "filled", sharesSold: 10, proceedsUsdc: 5.08 });
  expect(mocks.trade).toHaveBeenCalledTimes(4);
});

it("keeps the original sale pending while activity is incomplete and then saves its net cash", async () => {
  mocks.activity.mockResolvedValueOnce(activity().slice(0, 1));
  const first = await awaitPolymarketManualSellFinalOutcome({ account, buyRow: buy, sellOrderId: "sell",
    postResponse: { makingAmount: "10000000", takingAmount: "5200000" } });
  expect(first).toMatchObject({ outcome: "pending", sellOrderId: "sell" });
  expect(first).not.toHaveProperty("ordersToSave"); expect(mocks.mark).not.toHaveBeenCalled();
  expect(await awaitPolymarketManualSellFinalOutcome({ account, buyRow: buy, sellOrderId: "sell" }))
    .toMatchObject({ outcome: "filled", proceedsUsdc: 5.08 });
});

it.each(["wallet", "condition", "asset", "shares", "cash", "unconfirmed", "tx", "truncated"])("does not invent net proceeds for invalid %s evidence", async scenario => {
  const data = activity();
  if (scenario === "wallet") data[1]!.proxyWallet = `0x${"2".repeat(40)}`;
  if (scenario === "condition") data[1]!.conditionId = "other";
  if (scenario === "asset") data[1]!.asset = "other";
  if (scenario === "shares") data[1]!.size = 5;
  if (scenario === "cash") data[1]!.usdcSize = NaN;
  if (scenario === "truncated") mocks.activity.mockRejectedValue(new Error("partial page discarded"));
  else mocks.activity.mockResolvedValue(data);
  if (scenario === "unconfirmed" || scenario === "tx") mocks.trade.mockImplementation(async (_account, id) => rows.filter(row => row.id === id)
    .map(row => ({ ...row, ...(scenario === "unconfirmed" ? { status: "MINED" } : { transaction_hash: "" }) })));
  const result = await awaitPolymarketManualSellFinalOutcome({ account, buyRow: buy, sellOrderId: "sell",
    postResponse: { makingAmount: "10000000", takingAmount: "5200000" } });
  expect(result).toMatchObject({ outcome: "pending", sellOrderId: "sell" });
  expect(result).not.toHaveProperty("ordersToSave"); expect(mocks.mark).not.toHaveBeenCalled();
});

it("uses zero-fee wallet cash without another deduction and retains fee-inclusive buy cost", async () => {
  mocks.activity.mockResolvedValue(activity().map((row, index) => ({ ...row, usdcSize: index ? 3.6 : 1.6 })));
  const result = await awaitPolymarketManualSellFinalOutcome({ account, buyRow: { ...buy, pmStakeUsdc: 5.05 }, sellOrderId: "sell",
    postResponse: { makingAmount: "10000000", takingAmount: "5200000" } });
  expect(result).toMatchObject({ outcome: "filled", proceedsUsdc: 5.2, fillPrice: .52 });
  if (result.outcome === "filled") expect(result.ordersToSave[0]).toMatchObject({ pmSellProceeds: 5.2, pmRealizedPnlUsdc: .15 });
});

it("deduplicates repeated CLOB buckets and sums multiple fills in the same transaction once", async () => {
  mocks.trade.mockImplementation(async (_account, id) => rows.filter(row => row.id === id)
    .flatMap(row => [{ ...row, transaction_hash: tx1 }, { ...row, transaction_hash: tx1 }]));
  const data = activity().map(row => ({ ...row, transactionHash: tx1 }));
  mocks.activity.mockResolvedValue([...data, { ...data[0]! }]);
  const result = await awaitPolymarketManualSellFinalOutcome({ account, buyRow: buy, sellOrderId: "sell",
    postResponse: { makingAmount: "10000000", takingAmount: "5200000" } });
  expect(result).toMatchObject({ outcome: "filled", proceedsUsdc: 5.08, sharesSold: 10 });
});

it("accepts verified zero net cash as a loss instead of treating it as unknown", async () => {
  mocks.activity.mockResolvedValue(activity().map(row => ({ ...row, usdcSize: 0 })));
  const result = await awaitPolymarketManualSellFinalOutcome({ account, buyRow: buy, sellOrderId: "sell",
    postResponse: { makingAmount: "10000000", takingAmount: "5200000" } });
  expect(result).toMatchObject({ outcome: "filled", proceedsUsdc: 0, fillPrice: .52 });
  if (result.outcome === "filled") expect(result.ordersToSave[0]).toMatchObject({ pmSellProceeds: 0, pmRealizedPnlUsdc: -5 });
});

it("does not attribute a different asset or market's order to the original buy", async () => {
  const result = await awaitPolymarketManualSellFinalOutcome({ account, buyRow: { ...buy, pmTokenId: "other" }, sellOrderId: "sell",
    postResponse: { makingAmount: "10000000", takingAmount: "5200000" } });
  expect(result).toMatchObject({ outcome: "pending", sellOrderId: "sell" });
  expect(mocks.activity).not.toHaveBeenCalled();
});
