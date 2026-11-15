import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { readPolymarketSellCash } from "../../../../polymarket/orders/confirmation/orderSellCash";
vi.mock("../../../../polymarket/orders/confirmation/orderSellCash", () => ({ readPolymarketSellCash: vi.fn() }));

vi.mock("@changmen/venue-browser/polymarket/orders/confirmation/marketDelay", () => ({
  fetchPolymarketMarketSecondsDelay: vi.fn(async () => ({
    secondsDelay: 1,
    takerOrderDelayEnabled: false,
    fromMarket: true,
  })),
  UNKNOWN_SPORTS_SECONDS_DELAY: 30,
  buildPolymarketDelayedPollOpts: vi.fn(() => ({
    initialDelayMs: 1000,
    intervalMs: 1000,
    maxAttempts: 6,
  })),
  buildPolymarketWatchTimeoutMs: vi.fn(() => 20_000),
}));

vi.mock("@changmen/venue-browser/polymarket/realtime/userWs", () => ({
  registerPolymarketOrderWatch: vi.fn(),
}));

vi.mock("@changmen/venue-browser/polymarket/fok/settlementJob", () => ({
  startPolymarketSettlementJob: vi.fn(),
  awaitPolymarketSettlementJob: vi.fn(),
}));

vi.mock("@changmen/venue-browser/polymarket/fok/orderSettlement", () => ({
  settlePolymarketDelayedOrder: vi.fn(),
}));

vi.mock("@changmen/venue-browser/polymarket/orders/facts/orderStatus", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@changmen/venue-browser/polymarket/orders/facts/orderStatus")>();
  return {
    ...actual,
    fetchPolymarketOrderRow: vi.fn(),
  };
});

vi.mock("@changmen/venue-browser/polymarket/orders/confirmation/fillResolution", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@changmen/venue-browser/polymarket/orders/confirmation/fillResolution")>();
  return {
    ...actual,
    resolvePolymarketSellFillWithRetry: vi.fn(),
  };
});

import { settlePolymarketDelayedOrder } from "@changmen/venue-browser/polymarket/fok/orderSettlement";
import { fetchPolymarketOrderRow } from "@changmen/venue-browser/polymarket/orders/facts/orderStatus";
import { resolvePolymarketSellFillWithRetry } from "@changmen/venue-browser/polymarket/orders/confirmation/fillResolution";
import { awaitPolymarketManualSellFinalOutcome } from "@changmen/venue-browser/polymarket/submission/pmManualSell";
import { awaitPolymarketSettlementJob } from "@changmen/venue-browser/polymarket/fok/settlementJob";

function account(): PlatformAccount {
  return { accountId: 9, provider: "Polymarket", gateway: "", token: "{}" } as PlatformAccount;
}

const buy = {
  provider: "Polymarket" as const,
  orderId: "0xbuy",
  odds: 2,
  createAt: 1,
  betMoney: 100,
  reward: 0,
  money: 0,
  status: "none" as const,
  match: "A vs B",
  bet: "ml",
  item: "A",
  pmShares: 10,
  pmFillPrice: 0.5,
  pmStakeUsdc: 5,
  pmTokenId: "tok",
  pmConditionId: "0xc",
  pmSide: "buy" as const,
  pmSellState: "open" as const,
};

describe("awaitPolymarketManualSellFinalOutcome", () => {
  beforeEach(() => {
    vi.mocked(readPolymarketSellCash).mockReset().mockResolvedValue({ sharesSold: 10, proceedsUsdc: 5.4, fillPrice: .55 });
    vi.mocked(awaitPolymarketSettlementJob).mockReset();
    vi.mocked(settlePolymarketDelayedOrder).mockReset();
    vi.mocked(resolvePolymarketSellFillWithRetry).mockReset();
    vi.mocked(fetchPolymarketOrderRow).mockReset();
  });

  it("uses net cash after a full POST receipt, preserving the gross execution price", async () => {
    const out = await awaitPolymarketManualSellFinalOutcome({
      account: account(),
      buyRow: buy,
      sellOrderId: "0xs",
      postResponse: { makingAmount: "10000000", takingAmount: "5500000" },
      sharesWanted: 10,
    });
    expect(out.outcome).toBe("filled");
    if (out.outcome === "filled") {
      expect(out.sharesSold).toBe(10);
      expect(out.proceedsUsdc).toBe(5.4);
      expect(out.fillPrice).toBe(.55);
      expect(out.ordersToSave[0]).toMatchObject({ pmSellProceeds: 5.4, pmRealizedPnlUsdc: .4 });
      expect(out.ordersToSave[1]).toMatchObject({ pmFillPrice: .55, pmRealizedPnlUsdc: .4 });
      expect(out.ordersToSave.length).toBe(2);
    }
    expect(awaitPolymarketSettlementJob).not.toHaveBeenCalled();
    expect(readPolymarketSellCash).toHaveBeenCalledWith(expect.anything(), "0xs", 10, "tok", "0xc");
  });

  it.each([null, new Error("activity unavailable")])("a full POST without net cash stays pending: %s", async cash => {
    if (cash instanceof Error) vi.mocked(readPolymarketSellCash).mockRejectedValueOnce(cash);
    else vi.mocked(readPolymarketSellCash).mockResolvedValueOnce(cash);
    const out = await awaitPolymarketManualSellFinalOutcome({ account: account(), buyRow: buy, sellOrderId: "same-sell",
      postResponse: { makingAmount: "10000000", takingAmount: "5500000" } });
    expect(out).toMatchObject({ outcome: "pending", sellOrderId: "same-sell", reason: expect.stringContaining("净回款") });
    expect(out).not.toHaveProperty("ordersToSave");
  });

  it("unfilled when settlement says unfilled", async () => {
    vi.mocked(awaitPolymarketSettlementJob).mockResolvedValue({
      outcome: "unfilled",
      row: { status: "CANCELED", size_matched: "0" },
    });
    const out = await awaitPolymarketManualSellFinalOutcome({
      account: account(),
      buyRow: buy,
      sellOrderId: "0xu",
    });
    expect(out).toEqual({
      outcome: "unfilled",
      sellOrderId: "0xu",
      reason: "卖单未成交（FOK 已取消）",
    });
  });

  it("deadline ambiguous stays pending and cannot reopen sell", async () => {
    vi.mocked(awaitPolymarketSettlementJob).mockResolvedValue({
      outcome: "unfilled",
      row: { status: "DELAYED" },
    });
    vi.mocked(resolvePolymarketSellFillWithRetry).mockResolvedValue({
      sharesSold: 0,
      proceedsUsdc: 0,
    });
    vi.mocked(fetchPolymarketOrderRow).mockResolvedValue({ status: "DELAYED" });

    const out = await awaitPolymarketManualSellFinalOutcome({
      account: account(),
      buyRow: buy,
      sellOrderId: "0xt",
      fallbackPrice: 0.4,
    });
    expect(out.outcome).toBe("pending");
    if (out.outcome === "pending")
      expect(out.reason).toMatch(/待场馆确认/);
  });

  it("matched with size only + fallbackPrice stays pending instead of estimating cash", async () => {
    vi.mocked(awaitPolymarketSettlementJob).mockResolvedValue({
      outcome: "matched",
      row: { status: "MATCHED", size_matched: "8" },
    });
    vi.mocked(resolvePolymarketSellFillWithRetry).mockResolvedValue({
      sharesSold: 0,
      proceedsUsdc: 0,
    });

    const out = await awaitPolymarketManualSellFinalOutcome({
      account: account(),
      buyRow: buy,
      sellOrderId: "0xm",
      fallbackPrice: 0.5,
      sharesWanted: 10,
    });
    expect(out.outcome).toBe("pending");
    expect(out).not.toHaveProperty("ordersToSave");
  });

  it("keeps the original sell pending when confirmed shares lack an actual cash amount", async () => {
    vi.mocked(awaitPolymarketSettlementJob).mockResolvedValue({ outcome: "matched", row: { status: "MATCHED", size_matched: "8" } });
    vi.mocked(resolvePolymarketSellFillWithRetry).mockResolvedValue({ sharesSold: 8, proceedsUsdc: 0 });
    const out = await awaitPolymarketManualSellFinalOutcome({ account: account(), buyRow: buy, sellOrderId: "cash-pending", fallbackPrice: .5, sharesWanted: 10 });
    expect(out).toMatchObject({ outcome: "pending", sellOrderId: "cash-pending" });
    expect(out).not.toHaveProperty("ordersToSave");
  });

  it("matched without cash stays pending and cannot use the buy price as sell proceeds", async () => {
    vi.mocked(awaitPolymarketSettlementJob).mockResolvedValue({
      outcome: "matched",
      row: { status: "MATCHED", size_matched: "4" },
    });
    vi.mocked(resolvePolymarketSellFillWithRetry).mockResolvedValue({
      sharesSold: 0,
      proceedsUsdc: 0,
    });

    const out = await awaitPolymarketManualSellFinalOutcome({
      account: account(),
      buyRow: buy, // pmFillPrice 0.5
      sellOrderId: "0xm2",
    });
    expect(out.outcome).toBe("pending");
    expect(out).not.toHaveProperty("ordersToSave");
  });
});
