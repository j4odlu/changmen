import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchPolymarketConfirmedTradeForOrder = vi.fn();
const fetchPolymarketOrderRow = vi.fn();
const pmCancelOrder = vi.fn();
const awaitPolymarketOrderWatch = vi.fn();
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
  awaitPolymarketOrderWatch: (...args: unknown[]) => awaitPolymarketOrderWatch(...args),
  clearPolymarketOrderWatch: vi.fn(),
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
    fetchPolymarketConfirmedTradeForOrder.mockReset();
    fetchPolymarketOrderRow.mockReset();
    pmCancelOrder.mockReset();
    fetchPolymarketConfirmedTradeForOrder.mockResolvedValue(null);
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
    expect(pmCancelOrder).toHaveBeenCalledWith(acc, "0xd");
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

  it("runs FOK cancel path when poll leaves live resting", async () => {
    fetchPolymarketOrderRow.mockResolvedValue({ status: "cancelled", size_matched: "0" });
    pmCancelOrder.mockResolvedValue({});

    const out = await settlePolymarketDelayedOrder(acc, "0xlive", {
      tradeConfirm: { lookbackMs: 60_000, retryMs: 0, maxRetries: 1 },
      fokGrace: { graceMs: 0, graceIntervalMs: 0, postCancelAttempts: 1, postCancelIntervalMs: 0 },
    });

    expect(out.outcome).toBe("unfilled");
    expect(pmCancelOrder).toHaveBeenCalledWith(acc, "0xlive");
  });

  it("ws unfilled but REST still live → FOK finalize not blind unfilled", async () => {
    awaitPolymarketOrderWatch.mockResolvedValue({
      source: "ws",
      outcome: "unfilled",
      row: { status: "cancelled", size_matched: "0" },
    });
    // poll mock already returns live; trade none; must cancel+recheck
    fetchPolymarketOrderRow.mockResolvedValue({ status: "cancelled", size_matched: "0" });
    pmCancelOrder.mockResolvedValue({});

    const out = await settlePolymarketDelayedOrder(acc, "0xws-lag", {
      tradeConfirm: { lookbackMs: 60_000, retryMs: 0, maxRetries: 1 },
      fokGrace: { graceMs: 0, graceIntervalMs: 0, postCancelAttempts: 1, postCancelIntervalMs: 0 },
    });

    expect(out.outcome).toBe("unfilled");
    expect(pmCancelOrder).toHaveBeenCalledWith(acc, "0xws-lag");
  });

  it("poll timeout on delayed (no terminal row) → remains timeout", async () => {
    pollPolymarketDelayedOrder.mockResolvedValue({
      outcome: "timeout",
      row: { status: "delayed", size_matched: "0" },
    });
    fetchPolymarketOrderRow.mockResolvedValue({ status: "delayed", size_matched: "0" });
    pmCancelOrder.mockResolvedValue({});

    const out = await settlePolymarketDelayedOrder(acc, "0xdelay", {
      tradeConfirm: { lookbackMs: 60_000, retryMs: 0, maxRetries: 1 },
      fokGrace: { graceMs: 0, graceIntervalMs: 0, postCancelAttempts: 1, postCancelIntervalMs: 0 },
    });

    expect(out.outcome).toBe("timeout");
    expect(pmCancelOrder).toHaveBeenCalledWith(acc, "0xdelay");
  });
});
