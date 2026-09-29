import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";

vi.mock("./marketDelay", () => ({
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

vi.mock("./userWs", () => ({
  registerPolymarketOrderWatch: vi.fn(),
}));

vi.mock("./settlementJob", () => ({
  startPolymarketSettlementJob: vi.fn(),
  awaitPolymarketSettlementJob: vi.fn(),
}));

vi.mock("./orderSettlement", () => ({
  settlePolymarketDelayedOrder: vi.fn(),
}));

vi.mock("./orderStatus", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./orderStatus")>();
  return {
    ...actual,
    fetchPolymarketOrderRow: vi.fn(),
  };
});

vi.mock("./orders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./orders")>();
  return {
    ...actual,
    resolvePolymarketSellFillWithRetry: vi.fn(),
  };
});

import { settlePolymarketDelayedOrder } from "./orderSettlement";
import { fetchPolymarketOrderRow } from "./orderStatus";
import { resolvePolymarketSellFillWithRetry } from "./orders";
import { awaitPolymarketManualSellFinalOutcome } from "./pmManualSell";
import { awaitPolymarketSettlementJob } from "./settlementJob";

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
    vi.mocked(awaitPolymarketSettlementJob).mockReset();
    vi.mocked(settlePolymarketDelayedOrder).mockReset();
    vi.mocked(resolvePolymarketSellFillWithRetry).mockReset();
    vi.mocked(fetchPolymarketOrderRow).mockReset();
  });

  it("filled from post response without polling", async () => {
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
      expect(out.proceedsUsdc).toBe(5.5);
      expect(out.ordersToSave.length).toBe(2);
    }
    expect(awaitPolymarketSettlementJob).not.toHaveBeenCalled();
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

  it("matched with size only + fallbackPrice → filled", async () => {
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
    expect(out.outcome).toBe("filled");
    if (out.outcome === "filled") {
      expect(out.sharesSold).toBe(8);
      expect(out.proceedsUsdc).toBe(4);
    }
  });

  it("matched without fallbackPrice still filled via buy fill price (anti double-sell)", async () => {
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
    expect(out.outcome).toBe("filled");
    if (out.outcome === "filled") {
      expect(out.sharesSold).toBe(4);
      expect(out.proceedsUsdc).toBe(2);
    }
  });
});
