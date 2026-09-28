import type { VenueOrder } from "@changmen/venue-adapter/contract";
import type { PlatformAccount } from "@/models/platformAccount";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BetResult } from "@changmen/client-core/models/betResult";

import { settleArbLeg, settleArbLegUntilTerminal } from "./arbLegSettle";

const updateVenueOrders = vi.fn<() => Promise<VenueOrder[] | undefined>>();
const settlePolymarketDelayedOrder = vi.fn();
const awaitPolymarketSettlementJob = vi.fn();
const getPolymarketSettlementDelayCtx = vi.fn();
const fetchPolymarketConfirmedTradeForOrder = vi.fn();
const persistPolymarketExecutionReject = vi.fn();
const resolvePolymarketDelayedPollOpts = vi.fn();

vi.mock("@changmen/client-core/shared/wait", () => ({
  wait: vi.fn(async () => {}),
}));

vi.mock("@/stores/accountStore", () => ({
  useAccountStore: () => ({ updateVenueOrders }),
}));

vi.mock("@/stores/account/pmRejectOrder", () => ({
  persistPolymarketExecutionReject: (...args: unknown[]) => persistPolymarketExecutionReject(...args),
}));

vi.mock("@changmen/venue-adapter/polymarket/orderSettlement", () => ({
  settlePolymarketDelayedOrder: (...args: unknown[]) => settlePolymarketDelayedOrder(...args),
}));

vi.mock("@changmen/venue-adapter/polymarket/settlementJob", () => ({
  awaitPolymarketSettlementJob: (...args: unknown[]) => awaitPolymarketSettlementJob(...args),
  getPolymarketSettlementDelayCtx: (...args: unknown[]) => getPolymarketSettlementDelayCtx(...args),
  clearPolymarketSettlementJob: vi.fn(),
}));

vi.mock("@changmen/venue-adapter/polymarket/marketDelay", () => ({
  resolvePolymarketDelayedPollOpts: (...args: unknown[]) => resolvePolymarketDelayedPollOpts(...args),
}));

vi.mock("@changmen/venue-adapter/polymarket/orders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@changmen/venue-adapter/polymarket/orders")>();
  return {
    ...actual,
    fetchPolymarketConfirmedTradeForOrder: (...args: unknown[]) =>
      fetchPolymarketConfirmedTradeForOrder(...args),
  };
});

function account(provider: string): PlatformAccount {
  return { provider } as PlatformAccount;
}

function makeVenueOrder(
  partial: Pick<VenueOrder, "orderId" | "status" | "odds" | "betMoney">,
): VenueOrder {
  return {
    provider: "RAY",
    createAt: 0,
    reward: 0,
    money: 0,
    game: "",
    match: "",
    bet: "",
    item: "",
    ...partial,
  };
}

describe("settleArbLeg (Polymarket)", () => {
  beforeEach(() => {
    updateVenueOrders.mockReset();
    settlePolymarketDelayedOrder.mockReset();
    awaitPolymarketSettlementJob.mockReset();
    awaitPolymarketSettlementJob.mockResolvedValue(null);
    getPolymarketSettlementDelayCtx.mockReset();
    getPolymarketSettlementDelayCtx.mockReturnValue(null);
    resolvePolymarketDelayedPollOpts.mockReset();
    resolvePolymarketDelayedPollOpts.mockResolvedValue({
      initialDelayMs: 30_000,
      intervalMs: 1_000,
      maxAttempts: 8,
    });
    fetchPolymarketConfirmedTradeForOrder.mockReset();
    persistPolymarketExecutionReject.mockReset();
    persistPolymarketExecutionReject.mockResolvedValue(null);
  });

  it("prefers POST SettlementJob over settle when job exists", async () => {
    const acc = { provider: "Polymarket", accountId: 9 } as PlatformAccount;
    const result = Object.assign(new BetResult("Polymarket", true), {
      pending: true,
      orderId: "0xjob",
    });
    awaitPolymarketSettlementJob.mockResolvedValue({
      outcome: "matched",
      row: { status: "MATCHED", size_matched: "10" },
    });
    updateVenueOrders.mockResolvedValue([
      makeVenueOrder({ orderId: "0xjob", status: "none", odds: 2, betMoney: 14 }),
    ]);

    const out = await settleArbLeg(acc, result);

    expect(awaitPolymarketSettlementJob).toHaveBeenCalledWith(acc, "0xjob");
    expect(settlePolymarketDelayedOrder).not.toHaveBeenCalled();
    expect(out.rejected).toBe(false);
    expect(persistPolymarketExecutionReject).not.toHaveBeenCalled();
  });

  it("delayed pending unfilled → synthetic reject", async () => {
    const acc = account("Polymarket");
    const result = Object.assign(new BetResult("Polymarket", true), {
      pending: true,
      orderId: "0xdelayed",
    });
    settlePolymarketDelayedOrder.mockResolvedValue({ outcome: "unfilled", row: null });

    const out = await settleArbLeg(acc, result);

    expect(settlePolymarketDelayedOrder).toHaveBeenCalledWith(
      acc,
      "0xdelayed",
      expect.objectContaining({
        poll: expect.objectContaining({ initialDelayMs: 30_000 }),
      }),
    );
    expect(out.rejected).toBe(true);
    expect(out.orders[0]?.status).toBe("reject");
    expect(out.orders[0]?.orderId).toBe("0xdelayed");
    expect(result.pending).toBe(false);
    expect(updateVenueOrders).not.toHaveBeenCalled();
    expect(persistPolymarketExecutionReject).toHaveBeenCalledWith(
      acc,
      result,
      "unfilled",
      expect.objectContaining({}),
    );
  });

  it("timeout poll outcome stays pending and does not persist reject", async () => {
    const acc = account("Polymarket");
    const result = Object.assign(new BetResult("Polymarket", true), {
      pending: true,
      orderId: "0xtimeout",
    });
    settlePolymarketDelayedOrder.mockResolvedValue({ outcome: "timeout", row: null });

    const out = await settleArbLeg(acc, result);

    expect(out.rejected).toBe(false);
    expect(out.pendingConfirm).toBe(true);
    expect(result.pending).toBe(true);
    expect(result.reject).toBeNull();
    expect(persistPolymarketExecutionReject).not.toHaveBeenCalled();
  });

  it("delayed pending matched → refresh venue orders", async () => {
    const acc = account("Polymarket");
    const result = Object.assign(new BetResult("Polymarket", true), {
      pending: true,
      orderId: "0xmatched",
    });
    settlePolymarketDelayedOrder.mockResolvedValue({
      outcome: "matched",
      row: { status: "MATCHED", size_matched: "10" },
    });
    updateVenueOrders.mockResolvedValue([
      makeVenueOrder({ orderId: "0xmatched", status: "none", odds: 2, betMoney: 14 }),
    ]);

    const out = await settleArbLeg(acc, result);

    expect(updateVenueOrders).toHaveBeenCalledWith(
      acc,
      expect.objectContaining({
        pendingBindOrderId: expect.any(String),
        waitForOrderId: expect.any(String),
      }),
    );
    expect(out.rejected).toBe(false);
    expect(result.pending).toBe(false);
    expect(result.message).toContain("已成交");
  });

  it("POST matched trusts fill when venue list still shows old reject", async () => {
    const acc = account("Polymarket");
    const result = Object.assign(
      new BetResult("Polymarket", true, "matched", null, {
        success: true,
        status: "matched",
        orderID: "0xnew",
        makingAmount: "10000000",
        takingAmount: "20000000",
      }),
      { orderId: "0xnew" },
    );
    updateVenueOrders.mockResolvedValue([
      makeVenueOrder({ orderId: "0xold", status: "reject", odds: 2, betMoney: 10 }),
    ]);

    const out = await settleArbLeg(acc, result);

    expect(settlePolymarketDelayedOrder).not.toHaveBeenCalled();
    expect(updateVenueOrders).toHaveBeenCalledWith(
      acc,
      expect.objectContaining({
        pendingBindOrderId: expect.any(String),
        waitForOrderId: expect.any(String),
      }),
    );
    expect(out.rejected).toBe(false);
    expect(out.orders[0]?.orderId).toBe("0xnew");
  });

  it("uncertain fill polls trade before rejecting on stale list", async () => {
    const acc = account("Polymarket");
    const result = Object.assign(new BetResult("Polymarket", true), {
      orderId: "0xuncertain",
      response: { success: true, status: "live", orderID: "0xuncertain" },
    });
    fetchPolymarketConfirmedTradeForOrder.mockResolvedValueOnce({
      id: "trade-1",
      taker_order_id: "0xuncertain",
      status: "CONFIRMED",
    });
    updateVenueOrders.mockResolvedValue([
      makeVenueOrder({ orderId: "0xold", status: "reject", odds: 2, betMoney: 10 }),
    ]);

    const out = await settleArbLeg(acc, result);

    expect(fetchPolymarketConfirmedTradeForOrder).toHaveBeenCalled();
    expect(out.rejected).toBe(false);
  });

  it("honors result.reject without polling venue list", async () => {
    const acc = account("Polymarket");
    const result = Object.assign(new BetResult("Polymarket", true), {
      orderId: "0xsettled-unfilled",
      reject: "unfilled",
    });

    const out = await settleArbLeg(acc, result);

    expect(settlePolymarketDelayedOrder).not.toHaveBeenCalled();
    expect(fetchPolymarketConfirmedTradeForOrder).not.toHaveBeenCalled();
    expect(updateVenueOrders).not.toHaveBeenCalled();
    expect(out.rejected).toBe(true);
    expect(out.orders[0]?.orderId).toBe("0xsettled-unfilled");
  });

  it("polls settlement when trade missing and order not in venue list", async () => {
    const acc = account("Polymarket");
    const result = Object.assign(new BetResult("Polymarket", true), {
      orderId: "0xmissing",
      response: { success: true, status: "live", orderID: "0xmissing" },
    });
    fetchPolymarketConfirmedTradeForOrder.mockResolvedValueOnce(null);
    settlePolymarketDelayedOrder.mockResolvedValue({ outcome: "unfilled", row: null });

    const out = await settleArbLeg(acc, result);

    expect(settlePolymarketDelayedOrder).toHaveBeenCalledWith(
      acc,
      "0xmissing",
      expect.objectContaining({
        poll: expect.objectContaining({ initialDelayMs: 30_000 }),
      }),
    );
    expect(out.rejected).toBe(true);
    expect(result.reject).toBe("unfilled");
  });

  it("untilTerminal PM timeout is one round pending", async () => {
    const acc = account("Polymarket");
    const result = Object.assign(new BetResult("Polymarket", true), {
      pending: true,
      orderId: "0xstill",
    });
    settlePolymarketDelayedOrder.mockResolvedValue({ outcome: "timeout", row: { status: "delayed" } });

    const out = await settleArbLegUntilTerminal(acc, result);

    expect(out.pendingConfirm).toBe(true);
    expect(out.rejected).toBe(false);
    expect(result.pending).toBe(true);
    expect(result.reject).toBeNull();
    expect(persistPolymarketExecutionReject).not.toHaveBeenCalled();
    expect(settlePolymarketDelayedOrder).toHaveBeenCalledTimes(1);
  });

  it("passes betOption.betId as pmConditionId for sd fallback", async () => {
    const acc = account("Polymarket");
    const result = Object.assign(new BetResult("Polymarket", true), {
      pending: true,
      orderId: "0xcond",
    });
    settlePolymarketDelayedOrder.mockResolvedValue({ outcome: "unfilled", row: null });

    await settleArbLeg(acc, result, { betOption: { betId: "0xmarket-cond" } as never });

    expect(resolvePolymarketDelayedPollOpts).toHaveBeenCalledWith("0xmarket-cond");
  });
});
