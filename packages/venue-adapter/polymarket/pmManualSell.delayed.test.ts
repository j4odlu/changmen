import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";

vi.mock("./marketDelay", () => ({
  fetchPolymarketMarketSecondsDelay: vi.fn(),
  UNKNOWN_SPORTS_SECONDS_DELAY: 30,
  buildPolymarketDelayedPollOpts: vi.fn((sd: number) => ({
    initialDelayMs: Math.max(1000, sd * 1000),
    intervalMs: 1000,
    maxAttempts: 2,
  })),
  buildPolymarketWatchTimeoutMs: vi.fn((sd: number) => Math.min(90_000, sd * 1000 + 20_000)),
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

vi.mock("./orders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./orders")>();
  return {
    ...actual,
    resolvePolymarketSellFillWithRetry: vi.fn(),
  };
});

import { fetchPolymarketMarketSecondsDelay } from "./marketDelay";
import { settlePolymarketDelayedOrder } from "./orderSettlement";
import { resolvePolymarketSellFillWithRetry } from "./orders";
import { confirmPolymarketManualSellDelayedFill } from "./pmManualSell";
import {
  awaitPolymarketSettlementJob,
  startPolymarketSettlementJob,
} from "./settlementJob";
import { registerPolymarketOrderWatch } from "./userWs";

function account(): PlatformAccount {
  return { accountId: 1, provider: "Polymarket", gateway: "", token: "" } as PlatformAccount;
}

describe("confirmPolymarketManualSellDelayedFill", () => {
  beforeEach(() => {
    vi.mocked(fetchPolymarketMarketSecondsDelay).mockReset();
    vi.mocked(registerPolymarketOrderWatch).mockReset();
    vi.mocked(startPolymarketSettlementJob).mockReset();
    vi.mocked(awaitPolymarketSettlementJob).mockReset();
    vi.mocked(settlePolymarketDelayedOrder).mockReset();
    vi.mocked(resolvePolymarketSellFillWithRetry).mockReset();
  });

  it("uses market sd, registers WS watch, starts SELL settlement, then resolves fill", async () => {
    vi.mocked(fetchPolymarketMarketSecondsDelay).mockResolvedValue({
      secondsDelay: 3,
      takerOrderDelayEnabled: true,
      fromMarket: true,
    });
    vi.mocked(awaitPolymarketSettlementJob).mockResolvedValue({
      outcome: "matched",
      row: { status: "MATCHED", size_matched: "10" },
    });
    vi.mocked(resolvePolymarketSellFillWithRetry).mockResolvedValue({
      sharesSold: 10,
      proceedsUsdc: 5.5,
    });

    const out = await confirmPolymarketManualSellDelayedFill({
      account: account(),
      sellOrderId: "0xsell",
      conditionId: "0xcond",
      postResponse: { status: "delayed" } as never,
    });

    expect(out).toEqual({ sharesSold: 10, proceedsUsdc: 5.5 });
    expect(fetchPolymarketMarketSecondsDelay).toHaveBeenCalledWith("0xcond");
    expect(registerPolymarketOrderWatch).toHaveBeenCalledWith(
      expect.anything(),
      "0xsell",
      expect.objectContaining({ conditionId: "0xcond" }),
    );
    expect(startPolymarketSettlementJob).toHaveBeenCalledWith(
      expect.anything(),
      "0xsell",
      expect.objectContaining({
        side: "SELL",
        poll: expect.objectContaining({ initialDelayMs: 3000 }),
      }),
    );
    expect(settlePolymarketDelayedOrder).not.toHaveBeenCalled();
    expect(resolvePolymarketSellFillWithRetry).toHaveBeenCalledWith(
      expect.anything(),
      "0xsell",
      expect.anything(),
      expect.objectContaining({
        orderRow: { status: "MATCHED", size_matched: "10" },
      }),
    );
  });

  it("falls back to settle when no settlement job", async () => {
    vi.mocked(fetchPolymarketMarketSecondsDelay).mockResolvedValue({
      secondsDelay: 1,
      takerOrderDelayEnabled: false,
      fromMarket: true,
    });
    vi.mocked(awaitPolymarketSettlementJob).mockResolvedValue(null);
    vi.mocked(settlePolymarketDelayedOrder).mockResolvedValue({
      outcome: "matched",
      row: { status: "MATCHED", size_matched: "2" },
    });
    vi.mocked(resolvePolymarketSellFillWithRetry).mockResolvedValue({
      sharesSold: 2,
      proceedsUsdc: 1.1,
    });

    await confirmPolymarketManualSellDelayedFill({
      account: account(),
      sellOrderId: "0xs2",
      conditionId: "0xc2",
      postResponse: null,
    });

    expect(settlePolymarketDelayedOrder).toHaveBeenCalledWith(
      expect.anything(),
      "0xs2",
      expect.objectContaining({ side: "SELL" }),
    );
  });

  it("throws on unfilled without writing close", async () => {
    vi.mocked(fetchPolymarketMarketSecondsDelay).mockResolvedValue({
      secondsDelay: 1,
      takerOrderDelayEnabled: false,
      fromMarket: true,
    });
    vi.mocked(awaitPolymarketSettlementJob).mockResolvedValue({
      outcome: "unfilled",
      row: { status: "CANCELED" },
    });

    await expect(
      confirmPolymarketManualSellDelayedFill({
        account: account(),
        sellOrderId: "0xu",
        conditionId: "0xc",
        postResponse: null,
      }),
    ).rejects.toThrow(/未成交/);
    expect(resolvePolymarketSellFillWithRetry).not.toHaveBeenCalled();
  });

  it("skips WS register when conditionId empty", async () => {
    vi.mocked(awaitPolymarketSettlementJob).mockResolvedValue({
      outcome: "matched",
      row: { status: "MATCHED", size_matched: "1" },
    });
    vi.mocked(resolvePolymarketSellFillWithRetry).mockResolvedValue({
      sharesSold: 1,
      proceedsUsdc: 0.4,
    });

    await confirmPolymarketManualSellDelayedFill({
      account: account(),
      sellOrderId: "0xnocond",
      conditionId: "",
      postResponse: null,
    });

    expect(fetchPolymarketMarketSecondsDelay).not.toHaveBeenCalled();
    expect(registerPolymarketOrderWatch).not.toHaveBeenCalled();
    expect(startPolymarketSettlementJob).toHaveBeenCalledWith(
      expect.anything(),
      "0xnocond",
      expect.objectContaining({ side: "SELL" }),
    );
  });
});
