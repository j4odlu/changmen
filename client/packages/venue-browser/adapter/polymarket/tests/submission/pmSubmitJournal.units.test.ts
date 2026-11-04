import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { BetResult } from "@changmen/client-core/models/betResult";
import { guardedPmSubmit, pmAccountSubmitAttempts, clearPmSubmitJournalForTests, PmSubmitUnknownError } from "@changmen/venue-browser/polymarket/submission/recovery/pmSubmitJournal";
import { recoverPmUnknownSubmission } from "@changmen/venue-browser/polymarket/submission/recovery/pmUnknownSubmitRecovery";
import { awaitPolymarketManualSellFinalOutcome } from "@changmen/venue-browser/polymarket/submission/pmManualSell";
import { resolvePolymarketLegOutcome } from "@changmen/venue-browser/polymarket/orders/confirmation/legOutcome";

const mocks = vi.hoisted(() => ({ order: vi.fn(), trade: vi.fn(), watch: vi.fn(), fetch: vi.fn(), job: vi.fn(), sellFill: vi.fn() }));
vi.mock("@changmen/venue-browser/shared/webBridge", () => ({ useUserStore: () => ({ userId: 1 }) }));
vi.mock("@changmen/venue-browser/polymarket/realtime/userWs", async (load) => ({
  ...await load<typeof import("@changmen/venue-browser/polymarket/realtime/userWs")>(), readPolymarketOrderWatch: mocks.watch,
}));
vi.mock("@changmen/venue-browser/polymarket/orders/facts/orderStatus", async (load) => ({
  ...await load<typeof import("@changmen/venue-browser/polymarket/orders/facts/orderStatus")>(), fetchPolymarketOrderRow: mocks.order,
}));
vi.mock("@changmen/venue-browser/polymarket/orders/history/orders", async (load) => ({
  ...await load<typeof import("@changmen/venue-browser/polymarket/orders/history/orders")>(), fetchPolymarketConfirmedTradeForOrder: mocks.trade,
  resolvePolymarketSellFillWithRetry: mocks.sellFill,
}));
vi.mock("@changmen/venue-browser/polymarket/fok/settlementJob", async (load) => ({
  ...await load<typeof import("@changmen/venue-browser/polymarket/fok/settlementJob")>(),
  startPolymarketSettlementJob: vi.fn(), awaitPolymarketSettlementJob: mocks.job,
}));

const address = `0x${"1".repeat(40)}`;
const account = { accountId: 9001, provider: "Polymarket", gateway: "https://clob.polymarket.com",
  token: JSON.stringify({ walletAddress: address, funder: address, apiKey: "fake", secret: "ZmFrZQ==", passphrase: "fake" }) } as PlatformAccount;
const context = { version: 2 as const, negRisk: false };
function body(side: "BUY" | "SELL" = "SELL") {
  return { order: { salt: "1", maker: address, signer: address, tokenId: "123", makerAmount: "10000000",
    takerAmount: "6000000", side, signatureType: 0, timestamp: "1700000000000",
    metadata: `0x${"0".repeat(64)}`, builder: `0x${"0".repeat(64)}` } };
}
const buy = { provider: "Polymarket", orderId: "buy", odds: 2, createAt: 1, betMoney: 33.5, money: 0,
  reward: 0, status: "none" as const, pmTokenId: "123", pmShares: 10, pmStakeUsdc: 5,
  pmSide: "buy" as const, pmSellState: "open" as const };
const receipt = { success: true, orderID: "ack", status: "matched", makingAmount: "10000000", takingAmount: "6000000" };
afterEach(() => { clearPmSubmitJournalForTests(); vi.unstubAllGlobals(); });

beforeEach(() => {
  vi.unstubAllGlobals(); vi.clearAllMocks(); clearPmSubmitJournalForTests();
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    get length() { return storage.size; }, key: (i: number) => [...storage.keys()][i] ?? null,
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); }, clear: () => storage.clear(),
  });
  vi.stubGlobal("window", undefined); vi.stubGlobal("navigator", undefined);
  mocks.fetch.mockImplementation(() => { throw new Error("Offline test must not send venue HTTP"); });
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.order.mockResolvedValue(null); mocks.trade.mockResolvedValue(null); mocks.watch.mockReturnValue(undefined);
  mocks.job.mockResolvedValue(undefined); mocks.sellFill.mockResolvedValue({ sharesSold: 0, proceedsUsdc: 0 });
});

async function legacy(size: string, side: "BUY" | "SELL" = "SELL") {
  await guardedPmSubmit(account, body(side), context, async () => receipt);
  const key = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)!)
    .find(key => key.startsWith("changmen:pm:submission:v1:"))!;
  const row = JSON.parse(localStorage.getItem(key)!);
  row.evidence = { row: { id: "ack", status: "matched", size_matched: size }, trade: { size, price: "0.6" } };
  localStorage.setItem(key, JSON.stringify(row)); clearPmSubmitJournalForTests();
}

test.each([
  ["SELL", "10000000", "6000000", "10"],
  ["BUY", "6000000", "10000000", "10"],
  ["SELL", "10000", "6000", "0.01"],
  ["SELL", "10000000000", "6000000000", "10000"],
] as const)("normalizes raw %s receipt %s/%s once before persisting recovery quantities", async (side, makingAmount, takingAmount, shares) => {
  await guardedPmSubmit(account, body(side), context, async () => ({ ...receipt, makingAmount, takingAmount }));
  clearPmSubmitJournalForTests();
  expect(pmAccountSubmitAttempts(account)[0]!.evidence).toEqual({ quantityUnit: "shares",
    row: { id: "ack", status: "matched", size_matched: shares }, trade: { size: shares, price: "0.6" } });
});

test("reloaded matched SELL records retain ten shares and six USDC, and still block repeat submission", async () => {
  const post = vi.fn(async () => receipt);
  await guardedPmSubmit(account, body(), context, post); clearPmSubmitJournalForTests();
  const outcome = await awaitPolymarketManualSellFinalOutcome({ account, sellOrderId: "ack", buyRow: buy, sharesWanted: 10 });
  expect(outcome).toMatchObject({ outcome: "filled", sharesSold: 10, proceedsUsdc: 6 });
  if (outcome.outcome === "filled") {
    expect(outcome.ordersToSave.find(row => row.orderId === "buy"))
      .toMatchObject({ pmSellProceeds: 6, pmRealizedPnlUsdc: 1 });
  }
  await expect(guardedPmSubmit(account, body(), context, post)).rejects.toBeInstanceOf(PmSubmitUnknownError);
  expect(post).toHaveBeenCalledOnce(); expect(mocks.order).not.toHaveBeenCalled();
  expect(mocks.trade).not.toHaveBeenCalled(); expect(mocks.fetch).not.toHaveBeenCalled();
});

test.each(["10000000", "10"])("old SELL evidence %s is replaced by an original-order read, never guessed or rescaled", async size => {
  await legacy(size); mocks.trade.mockResolvedValue({ size: "10", price: "0.6" });
  const outcome = await awaitPolymarketManualSellFinalOutcome({ account, sellOrderId: "ack", buyRow: buy, sharesWanted: 10 });
  expect(outcome).toMatchObject({ outcome: "filled", sharesSold: 10, proceedsUsdc: 6 });
  expect(mocks.order).toHaveBeenCalledExactlyOnceWith(account, "ack");
  expect(mocks.trade).toHaveBeenCalledWith(account, "ack", expect.any(Number), "SELL", true);
  expect(pmAccountSubmitAttempts(account)[0]!.evidence)
    .toMatchObject({ quantityUnit: "shares", trade: { size: "10", price: "0.6" } });
});

test.each(["10000000", "10"])("unavailable original reads keep old evidence %s pending and retain the SELL lock", async size => {
  await legacy(size); mocks.order.mockRejectedValue(new Error("404")); mocks.trade.mockRejectedValue(new Error("offline"));
  const outcome = await awaitPolymarketManualSellFinalOutcome({ account, sellOrderId: "ack", buyRow: buy });
  expect(outcome).toMatchObject({ outcome: "pending" });
  const original = pmAccountSubmitAttempts(account)[0]!;
  expect(original.state).toBe("accepted"); expect(original.evidence?.trade?.size).toBe(size);
  expect(original.evidence).not.toHaveProperty("quantityUnit");
  const post = vi.fn(); await expect(guardedPmSubmit(account, body(), context, post)).rejects.toBeInstanceOf(PmSubmitUnknownError);
  expect(post).not.toHaveBeenCalled(); expect(mocks.fetch).not.toHaveBeenCalled();
});

test("a normalized GET order keeps its quantity above the old threshold and marks the persisted evidence", async () => {
  await legacy("10000000000");
  mocks.order.mockResolvedValue({ id: "ack", status: "MATCHED", size_matched: "10000", original_size: "10000" });
  expect(await recoverPmUnknownSubmission(account, "ack", "SELL", Date.now()))
    .toMatchObject({ quantityUnit: "shares", row: { size_matched: "10000", original_size: "10000" } });
  expect(pmAccountSubmitAttempts(account)[0]!.evidence)
    .toMatchObject({ quantityUnit: "shares", row: { size_matched: "10000" } });
});

test("an unmarked BUY recovery row cannot confirm a pending leg while original reads fail", async () => {
  await legacy("10000000", "BUY");
  const result = Object.assign(new BetResult("Polymarket", true), { pending: true, orderId: "ack" });
  const orders = vi.fn(async () => []);
  expect(await resolvePolymarketLegOutcome(account, result, { fetchVenueOrders: orders }))
    .toEqual({ orders: [], settlement: "timeout" });
  expect(mocks.order).toHaveBeenCalledWith(account, "ack"); expect(result.pending).toBe(true);
  expect(pmAccountSubmitAttempts(account)).toHaveLength(1); expect(orders).not.toHaveBeenCalled();
});

test.each(["GET", "WS"].flatMap(source => (["BUY", "SELL"] as const).flatMap(side =>
  ["0", "3"].map(size => ({ source, side, size })))))(
  "$source original $side terminal cancellation retains $size matched shares during legacy recovery", async ({ source, side, size }) => {
    await legacy("10000000", side);
    const row = { id: "ack", status: "CANCELED_MARKET_RESOLVED", size_matched: size, original_size: "10", associate_trades: [] };
    if (source === "WS") mocks.watch.mockReturnValue({ row });
    else mocks.order.mockResolvedValue(row);
    expect(await recoverPmUnknownSubmission(account, "ack", side, Date.now()))
      .toEqual({ quantityUnit: "shares", row });
    expect(pmAccountSubmitAttempts(account)[0]!.evidence).toEqual({ quantityUnit: "shares", row });
    expect(mocks.trade).not.toHaveBeenCalled();
    const post = vi.fn();
    if (side === "SELL") {
      await expect(guardedPmSubmit(account, body(), context, post)).rejects.toBeInstanceOf(PmSubmitUnknownError);
      expect(post).not.toHaveBeenCalled();
    }
  });

test("a terminal cancellation for another order cannot replace legacy evidence or release the SELL lock", async () => {
  await legacy("10000000");
  mocks.order.mockResolvedValue({ id: "another-order", status: "CANCELED_MARKET_RESOLVED", size_matched: "0" });
  expect(await recoverPmUnknownSubmission(account, "ack", "SELL", Date.now())).toBeNull();
  expect(pmAccountSubmitAttempts(account)[0]!.evidence).not.toHaveProperty("quantityUnit");
  const post = vi.fn();
  await expect(guardedPmSubmit(account, body(), context, post)).rejects.toBeInstanceOf(PmSubmitUnknownError);
  expect(post).not.toHaveBeenCalled();
});

test.each(["0", "3"])("legacy SELL with %s shares closes or reconciles through the ordinary settlement path", async size => {
  await legacy("10000000");
  const row = { id: "ack", status: "CANCELED_MARKET_RESOLVED", size_matched: size, original_size: "10", associate_trades: [] };
  mocks.order.mockResolvedValue(row);
  // A weaker job result must not erase the recovered partial fill.
  mocks.job.mockResolvedValue({ outcome: "unfilled", row: { ...row, size_matched: "0" } });
  const outcome = await awaitPolymarketManualSellFinalOutcome({ account, sellOrderId: "ack", buyRow: buy, fallbackPrice: 0.6 });
  if (size === "0") expect(outcome).toMatchObject({ outcome: "unfilled" });
  else {
    expect(outcome).toMatchObject({ outcome: "filled", sharesSold: 3, proceedsUsdc: 1.8 });
    if (outcome.outcome === "filled") expect(outcome.ordersToSave.find(order => order.orderId === "buy"))
      .toMatchObject({ pmSellProceeds: 1.8, pmRealizedPnlUsdc: 0.3 });
  }
  // Recovery alone cannot unlock another SELL before its caller finishes accounting.
  const post = vi.fn();
  await expect(guardedPmSubmit(account, body(), context, post)).rejects.toBeInstanceOf(PmSubmitUnknownError);
  expect(post).not.toHaveBeenCalled();
});

test("a zero-fill terminal BUY can finish legacy recovery and release its journal entry", async () => {
  await legacy("10000000", "BUY");
  const row = { id: "ack", status: "CANCELED_MARKET_RESOLVED", size_matched: "0", original_size: "10", associate_trades: [] };
  mocks.order.mockResolvedValue(row); mocks.job.mockResolvedValue({ outcome: "unfilled", row });
  const result = Object.assign(new BetResult("Polymarket", true), { pending: true, orderId: "ack" });
  expect(await resolvePolymarketLegOutcome(account, result, { fetchVenueOrders: vi.fn(async () => []) }))
    .toMatchObject({ settlement: "unfilled" });
  expect(pmAccountSubmitAttempts(account)).toHaveLength(0);
});
