import { describe, expect, it, vi } from "vitest";
import {
  applyPolymarketSettlementToResult,
  applyPolymarketBuyTimeoutPolicy,
  coercePolymarketFokPollOutcome,
  buildPolymarketExecutionRejectVenueOrder,
  buildPolymarketRejectVenueOrder,
  formatPolymarketSettlementMessage,
  interpretPolymarketOrderRow,
  isPolymarketBetResultFillConfirmed,
  isPolymarketDelayedPending,
  isPolymarketOrderIdRejected,
  isPolymarketPostedApiFailure,
  isPolymarketPostFillConfirmed,
  isPolymarketDelayLookupPending,
  isPolymarketRestingNoFill,
} from "./orderStatus";
import { settlePolymarketDelayedOrder } from "./orderSettlement";
import { BetResult } from "@changmen/client-core/models/betResult";

const fetchPolymarketConfirmedTradeForOrder = vi.fn();
const awaitPolymarketOrderWatch = vi.fn();

describe("BUY timeout policy rollback", () => {
  it.each([
    ["matched", "matched"],
    ["unfilled", "unfilled"],
    ["timeout", "unfilled"],
  ] as const)("restores the original FOK mapping: %s -> %s", (input, expected) => {
    expect(coercePolymarketFokPollOutcome(input)).toBe(expected);
  });
  it.each([null, { status: "delayed" }, { lookupError: "query failed" }])("exits exhausted confirmation with explicit local basis: %s", (row) => {
    const decision = applyPolymarketBuyTimeoutPolicy({ outcome: "timeout", row });
    expect(decision.outcome).toBe("unfilled");
    expect(decision.row?.confirmationBasis).toBe("timeout_policy");
    expect(decision.row?.status).not.toBe("CANCELED");
    expect(formatPolymarketSettlementMessage("original", decision.outcome, decision.row)).toContain("非官方拒单回执");
  });
  it("never overrides an existing fill or fabricates official rejection", () => {
    const matched = { outcome: "matched" as const, row: { size_matched: "10" } };
    expect(applyPolymarketBuyTimeoutPolicy(matched)).toBe(matched);
    const inconsistent = { outcome: "timeout" as const, row: { size_matched: "3", original_size: "10" } };
    expect(applyPolymarketBuyTimeoutPolicy(inconsistent)).toBe(inconsistent);
    const official = { outcome: "unfilled" as const, row: { status: "CANCELED", size_matched: "0" } };
    expect(applyPolymarketBuyTimeoutPolicy(official)).toBe(official);
  });
});

vi.mock("./orders", () => ({
  fetchPolymarketConfirmedTradeForOrder: (...args: unknown[]) =>
    fetchPolymarketConfirmedTradeForOrder(...args),
}));

vi.mock("./userWs", () => ({
  readPolymarketOrderTradeIds: vi.fn(() => []),
  observePolymarketOrderWatch: vi.fn(() => () => {}),
  awaitPolymarketOrderWatch: (...args: unknown[]) => awaitPolymarketOrderWatch(...args),
  clearPolymarketOrderWatch: vi.fn(),
  readPolymarketOrderWatch: vi.fn(() => null),
}));

describe("isPolymarketDelayedPending", () => {
  it("true for delayed without takingAmount", () => {
    expect(isPolymarketDelayedPending({
      success: true,
      status: "delayed",
      orderID: "0xabc",
      takingAmount: "",
    })).toBe(true);
  });

  it("false for matched fill", () => {
    expect(isPolymarketDelayedPending({
      success: true,
      status: "matched",
      orderID: "0xabc",
      takingAmount: "10",
    })).toBe(false);
  });
});

describe("isPolymarketPostFillConfirmed", () => {
  it("true when POST matched with takingAmount", () => {
    expect(isPolymarketPostFillConfirmed({
      success: true,
      status: "matched",
      orderID: "0x1",
      takingAmount: "8",
    })).toBe(true);
  });
});

describe("isPolymarketBetResultFillConfirmed", () => {
  it("reads matched from BetResult.response", () => {
    const result = Object.assign(
      new BetResult("Polymarket", true, "ok", null, {
        success: true,
        status: "matched",
        orderID: "0xnew",
        takingAmount: "5",
      }),
      { orderId: "0xnew" },
    );
    expect(isPolymarketBetResultFillConfirmed(result)).toBe(true);
  });
});

describe("isPolymarketOrderIdRejected", () => {
  it("does not inherit stale reject when our order is absent", () => {
    const orders = [{
      provider: "Polymarket" as const,
      orderId: "0xold",
      status: "reject" as const,
      odds: 2,
      createAt: 1,
      betMoney: 10,
      reward: 0,
      money: 0,
      game: "",
      match: "",
      bet: "",
      item: "",
    }];
    expect(isPolymarketOrderIdRejected(orders, "0xnew")).toBe(false);
  });
});

describe("interpretPolymarketOrderRow", () => {
  it("matched when size_matched > 0", () => {
    expect(interpretPolymarketOrderRow({ status: "MATCHED", size_matched: "12.5" }))
      .toBe("matched");
  });

  it("pending when order row not yet available", () => {
    expect(interpretPolymarketOrderRow(null)).toBe("pending");
    expect(interpretPolymarketOrderRow({})).toBe("pending");
  });

  it("pending for unmatched after sports delay (wait FOK cancel/match)", () => {
    expect(interpretPolymarketOrderRow({ status: "unmatched", size_matched: "0" }))
      .toBe("pending");
  });

  it("pending for live with no fill (wait FOK cancel/match)", () => {
    expect(interpretPolymarketOrderRow({ status: "live", size_matched: "0" }))
      .toBe("pending");
  });

  it("pending for matched with zero size until shares/trades appear", () => {
    expect(interpretPolymarketOrderRow({ status: "matched", size_matched: "0" }))
      .toBe("pending");
  });

  it("unfilled for canceled", () => {
    expect(interpretPolymarketOrderRow({ status: "CANCELED", size_matched: "0" }))
      .toBe("unfilled");
    expect(interpretPolymarketOrderRow({ status: "CANCELED" })).toBe("pending");
  });

  it("pending for delayed status", () => {
    expect(interpretPolymarketOrderRow({ status: "delayed" })).toBe("pending");
  });
});

describe("isPolymarketRestingNoFill / delay lookup", () => {
  it("never treats delayed as cancelable", () => {
    expect(isPolymarketRestingNoFill({ status: "delayed", size_matched: "0" })).toBe(false);
  });

  it("treats live / unmatched with no fill as resting", () => {
    expect(isPolymarketRestingNoFill({ status: "live", size_matched: "0" })).toBe(true);
    expect(isPolymarketRestingNoFill({ status: "unmatched", size_matched: "0" })).toBe(true);
  });

  it("empty or missing row is delay-lookup pending, not resting", () => {
    expect(isPolymarketRestingNoFill(null)).toBe(false);
    expect(isPolymarketRestingNoFill({})).toBe(false);
    expect(isPolymarketDelayLookupPending(null)).toBe(true);
    expect(isPolymarketDelayLookupPending({})).toBe(true);
  });
});

describe("formatPolymarketSettlementMessage", () => {
  it("formats matched and unfilled", () => {
    expect(formatPolymarketSettlementMessage("0x1", "matched", { status: "MATCHED", size_matched: "3" }))
      .toContain("已成交");
    expect(formatPolymarketSettlementMessage("0x1", "unfilled", null))
      .toContain("未成交");
    expect(formatPolymarketSettlementMessage("0x1", "timeout", null))
      .toContain("待确认");
  });
});

describe("applyPolymarketSettlementToResult", () => {
  it("clears pending and sets reject on unfilled", () => {
    const result = Object.assign(new BetResult("Polymarket", true), {
      pending: true,
      orderId: "0x1",
    });
    applyPolymarketSettlementToResult(result, "unfilled", null);
    expect(result.pending).toBe(false);
    expect(result.reject).toBe("unfilled");
    expect(result.message).toContain("未成交");
  });

  it("keeps pending on timeout without reject", () => {
    const result = Object.assign(new BetResult("Polymarket", true), {
      pending: true,
      orderId: "0x1",
      reject: "timeout",
    });
    applyPolymarketSettlementToResult(result, "timeout", null);
    expect(result.pending).toBe(true);
    expect(result.reject).toBeNull();
    expect(result.message).toContain("待确认");
    expect(result.message).toContain("核验诊断");
  });
});

describe("buildPolymarketRejectVenueOrder", () => {
  it("builds reject status order", () => {
    const acc = { provider: "Polymarket", accountId: 1 } as never;
    const result = Object.assign(new BetResult("Polymarket", true), {
      orderId: "0x1",
      beginTime: 1_700_000_000_000,
    });
    const order = buildPolymarketRejectVenueOrder(acc, result, "unfilled");
    expect(order.status).toBe("reject");
    expect(order.orderId).toBe("0x1");
    expect(order.pmSide).toBe("buy");
    expect(order.pmRejectReason).toBe("unfilled");
  });

});

describe("buildPolymarketExecutionRejectVenueOrder", () => {
  it("uses synthetic id when api_failed has no orderId", () => {
    const acc = { provider: "Polymarket", accountId: 42 } as never;
    const result = Object.assign(new BetResult("Polymarket", false, "fail"), {
      beginTime: 1_700_000_000_123,
    });
    const order = buildPolymarketExecutionRejectVenueOrder(acc, result, "api_failed", {
      betMoney: 12.5,
      odds: 1.8,
      link: 99,
    });
    expect(order.status).toBe("reject");
    expect(order.orderId).toBe("pm-rej-42-1700000000123-api_failed");
    // ctx.betMoney 为场馆 USDC → 落库 CNY + pmStakeUsdc
    expect(order.pmStakeUsdc).toBe(12.5);
    expect(order.betMoney).toBeCloseTo(12.5 * 6.7, 5);
    expect(order.money).toBe(0);
    expect(order.reward).toBe(0);
    expect(order.link).toBe(99);
    expect(order.pmRejectReason).toBe("api_failed");
    expect(order.pmSide).toBe("buy");
  });

  it("keeps official orderId for unfilled", () => {
    const acc = { provider: "Polymarket", accountId: 7 } as never;
    const result = Object.assign(new BetResult("Polymarket", true), {
      orderId: "0xabc",
      beginTime: 100,
    });
    const order = buildPolymarketExecutionRejectVenueOrder(acc, result, "unfilled", {
      betMoney: 5,
    });
    expect(order.orderId).toBe("0xabc");
    expect(order.pmRejectReason).toBe("unfilled");
    expect(order.pmStakeUsdc).toBe(5);
    expect(order.betMoney).toBeCloseTo(5 * 6.7, 5);
  });

  it("prefers response.orderID when result.orderId missing", () => {
    const acc = { provider: "Polymarket", accountId: 7 } as never;
    const result = Object.assign(new BetResult("Polymarket", false, "x"), {
      beginTime: 100,
      response: { orderID: "0xfrom-resp" },
    });
    const order = buildPolymarketExecutionRejectVenueOrder(acc, result, "api_failed");
    expect(order.orderId).toBe("0xfrom-resp");
  });

  it("prefers POST makerAmount USDC over ctx.betMoney", () => {
    const acc = { provider: "Polymarket", accountId: 7 } as never;
    const result = Object.assign(new BetResult("Polymarket", true), {
      orderId: "0xmaker",
      beginTime: 100,
      request: { order: { makerAmount: "5880000", side: "BUY" } },
    });
    const order = buildPolymarketExecutionRejectVenueOrder(acc, result, "unfilled", {
      betMoney: 0.88,
      odds: 9.09,
    });
    expect(order.pmStakeUsdc).toBe(5.88);
    expect(order.betMoney).toBeCloseTo(5.88 * 6.7, 5);
  });
});

describe("isPolymarketPostedApiFailure", () => {
  it("true when tip.pmPosted", () => {
    const result = Object.assign(new BetResult("Polymarket", false, "x"), {
      tip: { pmPosted: true },
    });
    expect(isPolymarketPostedApiFailure(result)).toBe(true);
  });

  it("false for pre-POST credential failure", () => {
    expect(isPolymarketPostedApiFailure(new BetResult("Polymarket", false, "凭证缺少"))).toBe(false);
  });
});

describe("settlePolymarketDelayedOrder", () => {
  it("uses ws outcome when watch already matched", async () => {
    awaitPolymarketOrderWatch.mockReset();
    awaitPolymarketOrderWatch.mockResolvedValueOnce({
      source: "ws",
      outcome: "matched",
      row: { status: "MATCHED", size_matched: "10" },
    });

    const out = await settlePolymarketDelayedOrder({ provider: "Polymarket" } as never, "0xws");

    expect(out.outcome).toBe("matched");
    expect(fetchPolymarketConfirmedTradeForOrder).not.toHaveBeenCalled();
  });

  it("falls back to trades when ws returns null", async () => {
    const acc = { provider: "Polymarket" } as never;
    awaitPolymarketOrderWatch.mockReset();
    awaitPolymarketOrderWatch.mockResolvedValueOnce(null);
    fetchPolymarketConfirmedTradeForOrder.mockReset();
    fetchPolymarketConfirmedTradeForOrder.mockResolvedValueOnce({
      id: "trade-1",
      size: "5.88",
      status: "MINED",
      side: "BUY",
      taker_order_id: "0xlate",
    });

    const out = await settlePolymarketDelayedOrder(acc, "0xlate", {
      poll: { initialDelayMs: 0, intervalMs: 0, maxAttempts: 1 },
      tradeConfirm: { lookbackMs: 60_000, retryMs: 0, maxRetries: 1 },
    });

    expect(out.outcome).toBe("matched");
    expect(out.row?.status).toBe("MINED");
    expect(fetchPolymarketConfirmedTradeForOrder).toHaveBeenCalledWith(acc, "0xlate", expect.any(Number), "BUY", true, true);
  });

  it("does not trust ws unfilled alone — confirms via trades", async () => {
    const acc = { provider: "Polymarket" } as never;
    awaitPolymarketOrderWatch.mockReset();
    awaitPolymarketOrderWatch.mockResolvedValueOnce({
      source: "ws",
      outcome: "unfilled",
      row: { status: "cancelled", size_matched: "0" },
    });
    fetchPolymarketConfirmedTradeForOrder.mockReset();
    fetchPolymarketConfirmedTradeForOrder.mockResolvedValueOnce({
      id: "trade-late",
      size: "9",
      status: "CONFIRMED",
      side: "BUY",
      taker_order_id: "0xws-unfilled-but-traded",
    });

    const out = await settlePolymarketDelayedOrder(acc, "0xws-unfilled-but-traded", {
      poll: { initialDelayMs: 0, intervalMs: 0, maxAttempts: 1 },
      tradeConfirm: { lookbackMs: 60_000, retryMs: 0, maxRetries: 1 },
    });

    expect(out.outcome).toBe("matched");
    expect(fetchPolymarketConfirmedTradeForOrder).toHaveBeenCalled();
  });
});
