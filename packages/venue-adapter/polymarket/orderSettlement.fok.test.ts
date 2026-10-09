import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchPolymarketConfirmedTradeForOrder = vi.fn();
const fetchPolymarketOrderRow = vi.fn();
const pmCancelOrder = vi.fn();
const awaitPolymarketOrderWatch = vi.fn();
const readPolymarketOrderWatch = vi.fn();
const pollPolymarketDelayedOrder = vi.fn(async () => ({
  outcome: "timeout" as const,
  row: { status: "live", size_matched: "0" },
}));

vi.mock("./orders", () => ({
  fetchPolymarketConfirmedTradeForOrder: (...args: unknown[]) =>
    fetchPolymarketConfirmedTradeForOrder(...args),
}));

vi.mock("./pmClientApi", () => ({
  pmCancelOrder: (...args: unknown[]) => pmCancelOrder(...args),
}));

vi.mock("./userWs", () => ({
  readPolymarketOrderTradeIds: vi.fn(() => []),
  observePolymarketOrderWatch: vi.fn(() => () => {}),
  awaitPolymarketOrderWatch: (...args: unknown[]) => awaitPolymarketOrderWatch(...args),
  clearPolymarketOrderWatch: vi.fn(),
  readPolymarketOrderWatch: (...args: unknown[]) => readPolymarketOrderWatch(...args),
}));

vi.mock("./orderStatus", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./orderStatus")>();
  return {
    ...actual,
    fetchPolymarketOrderRow: (...args: unknown[]) => fetchPolymarketOrderRow(...args),
    pollPolymarketDelayedOrder: (...args: unknown[]) => pollPolymarketDelayedOrder(...args),
  };
});

import {
  finalizePolymarketFokRestingOrder,
  settlePolymarketDelayedOrder,
} from "./orderSettlement";

describe("finalizePolymarketFokRestingOrder", () => {
  const acc = { provider: "Polymarket", accountId: 1, token: "{}" } as never;

  beforeEach(() => {
    readPolymarketOrderWatch.mockReset();
    fetchPolymarketConfirmedTradeForOrder.mockReset();
    fetchPolymarketOrderRow.mockReset();
    pmCancelOrder.mockReset();
    fetchPolymarketConfirmedTradeForOrder.mockResolvedValue(null);
  });

  it("does not reject a previously observed MATCHED when REST later returns the same trade FAILED", async () => {
    fetchPolymarketOrderRow.mockResolvedValue(null);
    readPolymarketOrderWatch.mockReturnValue({ outcome: "matched",
      row: { status: "MATCHED", size_matched: "10", associate_trades: ["trade-1"] } });
    fetchPolymarketConfirmedTradeForOrder.mockResolvedValue({ id: "trade-1", status: "FAILED",
      taker_order_id: "already-matched", side: "BUY" });
    const out = await finalizePolymarketFokRestingOrder(acc, "already-matched", null,
      { graceMs: 50, graceIntervalMs: 0, postCancelAttempts: 1 });
    expect(out.outcome).toBe("matched");
    expect(pmCancelOrder).not.toHaveBeenCalled();
  });

  it("uses explicit cancellation ACK when subsequent healthy lookups return no row", async () => {
    pmCancelOrder.mockResolvedValue({ canceled: ["0xack"], not_canceled: {} });
    fetchPolymarketOrderRow.mockResolvedValue(null);
    const result = await finalizePolymarketFokRestingOrder(acc, "0xack",
      { status: "live", size_matched: "0" }, { graceMs: 0, postCancelAttempts: 1 });
    expect(result.outcome).toBe("unfilled");
  });

  it("does not release the lock when trade verification failed after cancellation", async () => {
    pmCancelOrder.mockResolvedValue({ canceled: ["0xack"] });
    fetchPolymarketOrderRow.mockResolvedValue(null);
    fetchPolymarketConfirmedTradeForOrder.mockRejectedValue(new Error("HTTP 401"));
    const result = await finalizePolymarketFokRestingOrder(acc, "0xack",
      { status: "live", size_matched: "0" }, { graceMs: 0, postCancelAttempts: 1 });
    expect(result.outcome).toBe("timeout");
    expect(result.row?.lookupError).toContain("401");
  });

  it("during grace sees system cancel → unfilled without pmCancel", async () => {
    fetchPolymarketOrderRow.mockResolvedValue({ status: "cancelled", size_matched: "0" });

    const out = await finalizePolymarketFokRestingOrder(
      acc,
      "0x1",
      { status: "live", size_matched: "0" },
      { graceMs: 80, graceIntervalMs: 20, postCancelAttempts: 1 },
    );

    expect(out.outcome).toBe("unfilled");
    expect(pmCancelOrder).not.toHaveBeenCalled();
  });

  it("during grace delayed becomes matched without cancel", async () => {
    fetchPolymarketOrderRow
      .mockResolvedValueOnce({ status: "delayed", size_matched: "0" })
      .mockResolvedValue({ status: "MATCHED", size_matched: "4" });

    const out = await finalizePolymarketFokRestingOrder(
      acc,
      "0xgrace-d",
      { status: "delayed", size_matched: "0" },
      { graceMs: 80, graceIntervalMs: 20, postCancelAttempts: 1 },
    );

    expect(out.outcome).toBe("matched");
    expect(pmCancelOrder).not.toHaveBeenCalled();
  });

  it("404 row during grace waits then matched without cancel", async () => {
    fetchPolymarketOrderRow
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ status: "MATCHED", size_matched: "2" });

    const out = await finalizePolymarketFokRestingOrder(
      acc,
      "0x404",
      null,
      { graceMs: 80, graceIntervalMs: 20, postCancelAttempts: 1 },
    );

    expect(out.outcome).toBe("matched");
    expect(pmCancelOrder).not.toHaveBeenCalled();
  });

  it("cancels once after grace then unfilled", async () => {
    fetchPolymarketOrderRow
      .mockResolvedValueOnce({ status: "live", size_matched: "0" })
      .mockResolvedValue({ status: "cancelled", size_matched: "0" });
    pmCancelOrder.mockResolvedValue({});

    const out = await finalizePolymarketFokRestingOrder(
      acc,
      "0xrest",
      { status: "unmatched", size_matched: "0" },
      { graceMs: 0, graceIntervalMs: 0, postCancelAttempts: 2, postCancelIntervalMs: 0 },
    );

    expect(pmCancelOrder).toHaveBeenCalledWith(acc, "0xrest");
    expect(out.outcome).toBe("unfilled");
  });

  it("cancel race: trade appears → matched", async () => {
    fetchPolymarketOrderRow.mockResolvedValue({ status: "live", size_matched: "0" });
    pmCancelOrder.mockResolvedValue({});
    fetchPolymarketConfirmedTradeForOrder
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "t1",
        size: "4",
        status: "MATCHED",
        side: "BUY",
      });

    const out = await finalizePolymarketFokRestingOrder(
      acc,
      "0xrace",
      { status: "live", size_matched: "0" },
      { graceMs: 0, graceIntervalMs: 0, postCancelAttempts: 2, postCancelIntervalMs: 0 },
    );

    expect(out.outcome).toBe("matched");
    expect(out.row?.size_matched).toBe("4");
  });

  it("after delay window: delayed row after cancel attempt stays pending", async () => {
    fetchPolymarketOrderRow.mockResolvedValue({ status: "delayed", size_matched: "0" });
    pmCancelOrder.mockResolvedValue({});

    const out = await finalizePolymarketFokRestingOrder(
      acc,
      "0xd",
      { status: "delayed", size_matched: "0" },
      { graceMs: 0, postCancelAttempts: 1, postCancelIntervalMs: 0 },
    );
    expect(pmCancelOrder).not.toHaveBeenCalled();
    expect(out.outcome).toBe("timeout");
  });

  it("still live after cancel attempt → timeout until authoritative confirmation", async () => {
    fetchPolymarketOrderRow.mockResolvedValue({ status: "live", size_matched: "0" });
    pmCancelOrder.mockResolvedValue({});

    const out = await finalizePolymarketFokRestingOrder(
      acc,
      "0xhang",
      { status: "live", size_matched: "0" },
      { graceMs: 0, graceIntervalMs: 0, postCancelAttempts: 1, postCancelIntervalMs: 0 },
    );

    expect(pmCancelOrder).toHaveBeenCalledWith(acc, "0xhang");
    expect(out.outcome).toBe("timeout");
  });
});

describe("settlePolymarketDelayedOrder FOK resting", () => {
  const acc = { provider: "Polymarket", accountId: 1, token: "{}" } as never;

  beforeEach(() => {
    readPolymarketOrderWatch.mockReset();
    awaitPolymarketOrderWatch.mockReset();
    awaitPolymarketOrderWatch.mockResolvedValue(null);
    fetchPolymarketConfirmedTradeForOrder.mockReset();
    fetchPolymarketConfirmedTradeForOrder.mockResolvedValue(null);
    fetchPolymarketOrderRow.mockReset();
    pmCancelOrder.mockReset();
    pollPolymarketDelayedOrder.mockReset();
    pollPolymarketDelayedOrder.mockResolvedValue({
      outcome: "timeout",
      row: { status: "live", size_matched: "0" },
    });
  });
  afterEach(() => vi.useRealTimers());

  it.each([null, { status: "MATCHED", size_matched: "10", associate_trades: ["failed-trade"] }])(
    "uses terminal FAILED over an absent or stale matched order row: %j", async (row) => {
      fetchPolymarketOrderRow.mockResolvedValue(row);
      fetchPolymarketConfirmedTradeForOrder.mockResolvedValue({ id: "failed-trade", status: "FAILED",
        taker_order_id: "failed-order", side: "BUY", size: "10" });
      const out = await settlePolymarketDelayedOrder(acc, "failed-order", { poll: { initialDelayMs: 0 } });
      expect(out).toMatchObject({ outcome: "unfilled", row: { confirmationBasis: "trade_failed",
        status: "FAILED", size_matched: "0", associate_trades: ["failed-trade"] } });
      expect(pmCancelOrder).not.toHaveBeenCalled();
    });

  it("consumes a FAILED first discovered during trade retries", async () => {
    fetchPolymarketOrderRow.mockResolvedValue(null);
    fetchPolymarketConfirmedTradeForOrder.mockResolvedValueOnce(null).mockResolvedValue({
      id: "failed-trade", status: "TRADE_STATUS_FAILED", taker_order_id: "failed-retry", side: "BUY" });
    const out = await settlePolymarketDelayedOrder(acc, "failed-retry", {
      poll: { initialDelayMs: 0, maxAttempts: 1 }, tradeConfirm: { retryMs: 0, maxRetries: 1 },
    });
    expect(out).toMatchObject({ outcome: "unfilled", row: { confirmationBasis: "trade_failed" } });
    expect(pmCancelOrder).not.toHaveBeenCalled();
  });

  it("keeps a MATCHED received during an in-flight trade retry ahead of REST FAILED", async () => {
    fetchPolymarketOrderRow.mockResolvedValue(null);
    fetchPolymarketConfirmedTradeForOrder.mockResolvedValueOnce(null).mockImplementationOnce(async () => {
      readPolymarketOrderWatch.mockReturnValue({ outcome: "matched",
        row: { status: "MATCHED", size_matched: "10", associate_trades: ["trade-1"] } });
      return { id: "trade-1", status: "FAILED", taker_order_id: "retry-race", side: "BUY" };
    });
    const out = await settlePolymarketDelayedOrder(acc, "retry-race", {
      poll: { initialDelayMs: 0, maxAttempts: 1 }, tradeConfirm: { maxRetries: 1, retryMs: 0 },
    });
    expect(out.outcome).toBe("matched");
  });

  it("cross-checks REST FAILED against tradeIds already known from WS", async () => {
    fetchPolymarketOrderRow.mockResolvedValue(null);
    readPolymarketOrderWatch.mockReturnValue({ outcome: "matched",
      row: { status: "MATCHED", size_matched: "10", associate_trades: ["other-trade"] } });
    fetchPolymarketConfirmedTradeForOrder.mockResolvedValue({ id: "failed-trade", status: "FAILED",
      taker_order_id: "cross-source", side: "BUY" });
    const out = await settlePolymarketDelayedOrder(acc, "cross-source", { poll: { initialDelayMs: 0 } });
    expect(out.outcome).toBe("matched");
    expect(out.row?.confirmationBasis).not.toBe("trade_failed");
  });

  it("does not turn a conflicting failed trade into a positive fill", async () => {
    fetchPolymarketOrderRow.mockResolvedValue({ status: "delayed", associate_trades: ["other-trade"] });
    fetchPolymarketConfirmedTradeForOrder.mockResolvedValue({
      id: "failed-trade", status: "FAILED", taker_order_id: "conflict", side: "BUY" });
    const out = await settlePolymarketDelayedOrder(acc, "conflict", {
      poll: { initialDelayMs: 0, maxAttempts: 1 },
    });
    expect(out.row?.confirmationBasis).not.toBe("trade_failed");
    expect(out.row?.status).not.toBe("FAILED");
  });

  it("finishes finite retries despite hanging reads without a 15-second cutoff", async () => {
    vi.useFakeTimers();
    fetchPolymarketOrderRow.mockImplementation(() => new Promise(() => {}));
    fetchPolymarketConfirmedTradeForOrder.mockImplementation(() => new Promise(() => {}));
    const start = Date.now();
    let finished = false;
    const pending = settlePolymarketDelayedOrder(acc, "unknown", {
      poll: { initialDelayMs: 0, maxAttempts: 1 },
      tradeConfirm: { maxRetries: 5, retryMs: 0 },
      fokGrace: { graceMs: 0, postCancelAttempts: 1 },
    }).then(result => { finished = true; return result; });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(7_000);
    expect((await pending).outcome).toBe("timeout");
    expect(Date.now() - start).toBe(22_000);
    expect(fetchPolymarketConfirmedTradeForOrder).toHaveBeenCalledTimes(7);
    expect(pmCancelOrder).not.toHaveBeenCalled();
  });

  it("finds old fills after resume without waiting the sports delay again", async () => {
    vi.useFakeTimers();
    const submittedAt = Date.now() - 30 * 60_000;
    fetchPolymarketOrderRow.mockResolvedValue(null);
    fetchPolymarketConfirmedTradeForOrder.mockResolvedValue({ id: "old", status: "CONFIRMED", size: "8" });
    const pending = settlePolymarketDelayedOrder(acc, "old", { submittedAt, poll: { initialDelayMs: 30_000 } });
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).outcome).toBe("matched");
    expect(fetchPolymarketConfirmedTradeForOrder).toHaveBeenCalledWith(acc, "old", 31 * 60_000, "BUY", true, true);
  });

  it("accepts a late WS cancellation after healthy REST/trade reconciliation", async () => {
    readPolymarketOrderWatch.mockReturnValue({ outcome: "unfilled", row: { status: "canceled", size_matched: "0" } });
    fetchPolymarketOrderRow.mockResolvedValue(null);
    expect((await settlePolymarketDelayedOrder(acc, "late")).outcome).toBe("unfilled");
    expect(pmCancelOrder).not.toHaveBeenCalled();
  });

  it("treats inconsistent FOK quantities as confirmation error, not a business fill state", async () => {
    fetchPolymarketOrderRow.mockResolvedValue({ status: "CANCELED", size_matched: "3", original_size: "10" });
    fetchPolymarketConfirmedTradeForOrder.mockResolvedValue({ id: "partial-trade", size: "3", status: "MATCHED" });
    const result = await settlePolymarketDelayedOrder(acc, "partial");
    expect(result.outcome).toBe("timeout");
    expect(result.row?.size_matched).toBe("3");
    expect(result.row?.lookupError).toContain("FOK 回执数量不一致");
  });

  it("allows REST full fill to supersede an incomplete WS snapshot", async () => {
    awaitPolymarketOrderWatch.mockResolvedValue({ outcome: "matched", row: { size_matched: "3", original_size: "10" } });
    fetchPolymarketOrderRow.mockResolvedValue({ status: "MATCHED", size_matched: "10", original_size: "10" });
    const result = await settlePolymarketDelayedOrder(acc, "partial-then-full");
    expect(result.outcome).toBe("matched");
    expect(result.row?.size_matched).toBe("10");
  });

  it("runs FOK cancel path when poll leaves live resting", async () => {
    fetchPolymarketOrderRow.mockResolvedValueOnce({ status: "live", size_matched: "0" })
      .mockResolvedValue({ status: "cancelled", size_matched: "0" });
    pmCancelOrder.mockResolvedValue({});

    const out = await settlePolymarketDelayedOrder(acc, "0xlive", {
      tradeConfirm: { lookbackMs: 60_000, retryMs: 0, maxRetries: 1 },
      fokGrace: { graceMs: 0, graceIntervalMs: 0, postCancelAttempts: 1, postCancelIntervalMs: 0 },
    });

    expect(out.outcome).toBe("unfilled");
    expect(pmCancelOrder).toHaveBeenCalledWith(acc, "0xlive");
  });

  it("official zero-fill cancellation ends confirmation without waiting for REST or canceling again", async () => {
    awaitPolymarketOrderWatch.mockResolvedValue({
      source: "ws",
      outcome: "unfilled",
      row: { status: "cancelled", size_matched: "0" },
    });
    // REST 可能滞后；原单明确零成交取消是终态。
    fetchPolymarketOrderRow.mockResolvedValueOnce({ status: "live", size_matched: "0" })
      .mockResolvedValue({ status: "cancelled", size_matched: "0" });
    pmCancelOrder.mockResolvedValue({});

    const out = await settlePolymarketDelayedOrder(acc, "0xws-lag", {
      tradeConfirm: { lookbackMs: 60_000, retryMs: 0, maxRetries: 1 },
      fokGrace: { graceMs: 0, graceIntervalMs: 0, postCancelAttempts: 1, postCancelIntervalMs: 0 },
    });

    expect(out.outcome).toBe("unfilled");
    expect(pmCancelOrder).not.toHaveBeenCalled();
  });

  it("bounds cancellation cross-check to 3 seconds even when REST hangs", async () => {
    vi.useFakeTimers();
    const start = Date.now();
    awaitPolymarketOrderWatch.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({
      outcome: "unfilled", row: { status: "canceled", size_matched: "0" },
    }), 100)));
    fetchPolymarketOrderRow.mockImplementation(() => new Promise(() => {}));
    fetchPolymarketConfirmedTradeForOrder.mockImplementation(() => new Promise(() => {}));
    const pending = settlePolymarketDelayedOrder(acc, "cancel-fast");
    await vi.advanceTimersByTimeAsync(3_100);
    expect((await pending).outcome).toBe("unfilled");
    expect(Date.now() - start).toBe(3_100);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(pmCancelOrder).not.toHaveBeenCalled();
  });

  it("prefers a newer matched event over an earlier cancellation promise", async () => {
    awaitPolymarketOrderWatch.mockResolvedValue({ outcome: "unfilled", row: { status: "canceled", size_matched: "0" } });
    readPolymarketOrderWatch.mockReturnValue({ outcome: "matched", row: { status: "matched", size_matched: "10" } });
    expect((await settlePolymarketDelayedOrder(acc, "newer-fill")).outcome).toBe("matched");
  });

  it("poll timeout on delayed (no terminal row) → remains timeout", async () => {
    pollPolymarketDelayedOrder.mockResolvedValue({
      outcome: "timeout",
      row: { status: "delayed", size_matched: "0" },
    });
    fetchPolymarketOrderRow.mockResolvedValue({ status: "delayed", size_matched: "0" });
    pmCancelOrder.mockResolvedValue({});

    const out = await settlePolymarketDelayedOrder(acc, "0xdelay", {
      poll: { initialDelayMs: 0, intervalMs: 0, maxAttempts: 1 },
      tradeConfirm: { lookbackMs: 60_000, retryMs: 0, maxRetries: 1 },
      fokGrace: { graceMs: 0, graceIntervalMs: 0, postCancelAttempts: 1, postCancelIntervalMs: 0 },
    });

    expect(out.outcome).toBe("timeout");
    expect(pmCancelOrder).not.toHaveBeenCalled();
  });
});
