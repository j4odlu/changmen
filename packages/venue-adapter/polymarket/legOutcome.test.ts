import type { VenueOrder } from "../contract";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BetResult } from "@changmen/client-core/models/betResult";
import { resolvePolymarketLegOutcome } from "./legOutcome";

const settlePolymarketDelayedOrder = vi.fn();
const awaitPolymarketSettlementJob = vi.fn();
const getPolymarketSettlementDelayCtx = vi.fn();
const fetchPolymarketConfirmedTradeForOrder = vi.fn();
const resolvePolymarketDelayedPollOpts = vi.fn();
const readPolymarketOrderWatch = vi.fn();

vi.mock("./userWs", () => ({
  readPolymarketOrderWatch: (...args: unknown[]) => readPolymarketOrderWatch(...args),
}));

vi.mock("./orderSettlement", () => ({
  settlePolymarketDelayedOrder: (...args: unknown[]) => settlePolymarketDelayedOrder(...args),
}));

vi.mock("./settlementJob", () => ({
  awaitPolymarketSettlementJob: (...args: unknown[]) => awaitPolymarketSettlementJob(...args),
  getPolymarketSettlementDelayCtx: (...args: unknown[]) => getPolymarketSettlementDelayCtx(...args),
  clearPolymarketSettlementJob: vi.fn(),
}));

vi.mock("./marketDelay", () => ({
  resolvePolymarketDelayedPollOpts: (...args: unknown[]) => resolvePolymarketDelayedPollOpts(...args),
}));

vi.mock("./orders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./orders")>();
  return {
    ...actual,
    fetchPolymarketConfirmedTradeForOrder: (...args: unknown[]) =>
      fetchPolymarketConfirmedTradeForOrder(...args),
  };
});

function account(): PlatformAccount {
  return { provider: "Polymarket", accountId: 9 } as PlatformAccount;
}

function makeVenueOrder(
  partial: Pick<VenueOrder, "orderId" | "status" | "odds" | "betMoney">,
): VenueOrder {
  return {
    provider: "Polymarket",
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

describe("resolvePolymarketLegOutcome", () => {
  const fetchVenueOrders = vi.fn<() => Promise<VenueOrder[]>>();

  beforeEach(() => {
    readPolymarketOrderWatch.mockReset();
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
    fetchVenueOrders.mockReset();
    fetchVenueOrders.mockResolvedValue([]);
  });

  it.each(["timeout", "unfilled"] as const)("prefers a late full fill over cached %s", async (outcome) => {
    awaitPolymarketSettlementJob.mockResolvedValue({ outcome, row: null });
    readPolymarketOrderWatch.mockReturnValue({ outcome: "matched", row: { size_matched: "10", original_size: "10" } });
    const result = Object.assign(new BetResult("Polymarket", true), { pending: true, orderId: "late" });
    const out = await resolvePolymarketLegOutcome(account(), result, { fetchVenueOrders });
    expect(out.settlement).toBe("filled");
    expect(result.pending).toBe(false);
    expect(result.reject).toBeFalsy();
  });

  it("does not promote an inconsistent late quantity to full fill", async () => {
    awaitPolymarketSettlementJob.mockResolvedValue({ outcome: "timeout", row: null });
    readPolymarketOrderWatch.mockReturnValue({ outcome: "matched", row: { size_matched: "3", original_size: "10" } });
    const result = Object.assign(new BetResult("Polymarket", true), { pending: true, orderId: "inconsistent" });
    const out = await resolvePolymarketLegOutcome(account(), result, { fetchVenueOrders });
    expect(out.settlement).toBe("timeout");
    expect(result.reject).toBeFalsy();
  });

  it("prefers POST SettlementJob over settle when job exists", async () => {
    const result = Object.assign(new BetResult("Polymarket", true), {
      pending: true,
      orderId: "0xjob",
    });
    awaitPolymarketSettlementJob.mockResolvedValue({
      outcome: "matched",
      row: { status: "MATCHED", size_matched: "10" },
    });
    fetchVenueOrders.mockResolvedValue([
      makeVenueOrder({ orderId: "0xjob", status: "none", odds: 2, betMoney: 14 }),
    ]);

    const out = await resolvePolymarketLegOutcome(account(), result, { fetchVenueOrders });

    expect(awaitPolymarketSettlementJob).toHaveBeenCalledWith(account(), "0xjob");
    expect(settlePolymarketDelayedOrder).not.toHaveBeenCalled();
    expect(out.settlement).toBe("filled");
    expect(out.orders[0]?.orderId).toBe("0xjob");
  });

  it("delayed pending unfilled → settlement unfilled", async () => {
    const result = Object.assign(new BetResult("Polymarket", true), {
      pending: true,
      orderId: "0xdelayed",
    });
    settlePolymarketDelayedOrder.mockResolvedValue({ outcome: "unfilled", row: null });

    const out = await resolvePolymarketLegOutcome(account(), result, { fetchVenueOrders });

    expect(settlePolymarketDelayedOrder).toHaveBeenCalledWith(
      account(),
      "0xdelayed",
      expect.objectContaining({
        poll: expect.objectContaining({ initialDelayMs: 30_000 }),
      }),
    );
    expect(out.settlement).toBe("unfilled");
    expect(out.orders[0]?.status).toBe("reject");
    expect(result.pending).toBe(false);
    expect(fetchVenueOrders).not.toHaveBeenCalled();
  });

  it("poll exhausted → policy rejection releases pending and enables makeup", async () => {
    const result = Object.assign(new BetResult("Polymarket", true), {
      pending: true,
      orderId: "0xtimeout",
    });
    settlePolymarketDelayedOrder.mockResolvedValue({
      outcome: "timeout",
      row: { status: "delayed" },
    });

    const out = await resolvePolymarketLegOutcome(account(), result, { fetchVenueOrders });

    expect(out.settlement).toBe("unfilled");
    expect(out.orders[0]?.status).toBe("reject");
    expect(result.pending).toBe(false);
    expect(result.reject).toBe("unfilled");
    expect(result.message).toContain("非官方拒单回执");
  });

  it("applies the same policy to a completed background Job timeout", async () => {
    const result = Object.assign(new BetResult("Polymarket", true), { pending: true, orderId: "0xjob-timeout" });
    awaitPolymarketSettlementJob.mockResolvedValue({ outcome: "timeout", row: null });
    const out = await resolvePolymarketLegOutcome(account(), result, { fetchVenueOrders });
    expect(out.settlement).toBe("unfilled");
    expect(result.pending).toBe(false);
    expect(result.message).toContain("超时策略判拒");
    expect(settlePolymarketDelayedOrder).not.toHaveBeenCalled();
  });

  it("honors result.reject without polling venue list", async () => {
    const result = Object.assign(new BetResult("Polymarket", true), {
      orderId: "0xsettled-unfilled",
      reject: "unfilled",
    });

    const out = await resolvePolymarketLegOutcome(account(), result, { fetchVenueOrders });

    expect(settlePolymarketDelayedOrder).not.toHaveBeenCalled();
    expect(fetchPolymarketConfirmedTradeForOrder).not.toHaveBeenCalled();
    expect(fetchVenueOrders).not.toHaveBeenCalled();
    expect(out.settlement).toBe("unfilled");
  });

  it("POST matched trusts fill when venue list still shows old reject", async () => {
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
    fetchVenueOrders.mockResolvedValue([
      makeVenueOrder({ orderId: "0xold", status: "reject", odds: 2, betMoney: 10 }),
    ]);

    const out = await resolvePolymarketLegOutcome(account(), result, { fetchVenueOrders });

    expect(out.settlement).toBe("filled");
    expect(out.orders[0]?.orderId).toBe("0xnew");
    expect(settlePolymarketDelayedOrder).not.toHaveBeenCalled();
    // 合成单补 fee：可查 trades 取 conditionId，但不走 delayed settle
    expect(fetchPolymarketConfirmedTradeForOrder).toHaveBeenCalled();
    expect(fetchVenueOrders).toHaveBeenCalledTimes(1);
  });

  it("polls settlement when trade missing and order not in venue list", async () => {
    const result = Object.assign(new BetResult("Polymarket", true), {
      orderId: "0xmissing",
      response: { success: true, status: "live", orderID: "0xmissing" },
    });
    fetchPolymarketConfirmedTradeForOrder.mockResolvedValueOnce(null);
    settlePolymarketDelayedOrder.mockResolvedValue({ outcome: "unfilled", row: null });

    const out = await resolvePolymarketLegOutcome(account(), result, { fetchVenueOrders });

    expect(settlePolymarketDelayedOrder).toHaveBeenCalledWith(
      account(),
      "0xmissing",
      expect.objectContaining({
        poll: expect.objectContaining({ initialDelayMs: 30_000 }),
      }),
    );
    expect(out.settlement).toBe("unfilled");
    expect(result.reject).toBe("unfilled");
  });

  it("fallback settle reuses job delay poll without refetching sd", async () => {
    const poll = { initialDelayMs: 3_000, intervalMs: 1_000, maxAttempts: 8 };
    getPolymarketSettlementDelayCtx.mockReturnValue({
      poll,
      conditionId: "0xc",
    });
    const result = Object.assign(new BetResult("Polymarket", true), {
      pending: true,
      orderId: "0xctx",
    });
    settlePolymarketDelayedOrder.mockResolvedValue({ outcome: "unfilled", row: null });

    await resolvePolymarketLegOutcome(account(), result, { fetchVenueOrders });

    expect(settlePolymarketDelayedOrder).toHaveBeenCalledWith(
      account(),
      "0xctx",
      expect.objectContaining({ poll }),
    );
    expect(resolvePolymarketDelayedPollOpts).not.toHaveBeenCalled();
  });

  it("an unknown POST cannot use the accepted BUY timeout policy or unrelated venue orders", async () => {
    const result = Object.assign(new BetResult("Polymarket", false), { pending: true,
      orderId: "0xlocalhash", pmSubmitUnknown: true, pmSubmittedAt: 1_700_000_000_000 });
    fetchPolymarketConfirmedTradeForOrder.mockResolvedValue(null);
    fetchVenueOrders.mockResolvedValue([makeVenueOrder({ orderId: "other", status: "none", odds: 2, betMoney: 10 })]);
    expect(await resolvePolymarketLegOutcome(account(), result, { fetchVenueOrders }))
      .toEqual({ orders: [], settlement: "timeout" });
    expect(settlePolymarketDelayedOrder).not.toHaveBeenCalled();
    expect(awaitPolymarketSettlementJob).not.toHaveBeenCalled();
    expect(fetchVenueOrders).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: false, pending: true, pmSubmitUnknown: true, reject: null });
  });

  it("a matching authenticated WS receipt can promote unknown submission to accepted BUY handling", async () => {
    const result = Object.assign(new BetResult("Polymarket", false), { pending: true,
      orderId: "0xlocalhash", pmSubmitUnknown: true, pmSubmittedAt: 1_700_000_000_000 });
    readPolymarketOrderWatch.mockReturnValue({ outcome: "timeout", row: { id: "0xlocalhash", status: "delayed" } });
    settlePolymarketDelayedOrder.mockResolvedValue({ outcome: "timeout", row: null });
    const outcome = await resolvePolymarketLegOutcome(account(), result, { fetchVenueOrders });
    expect(result.pmSubmitUnknown).toBe(false);
    expect(result.success).toBe(true);
    expect(outcome.settlement).toBe("unfilled");
    expect(settlePolymarketDelayedOrder).toHaveBeenCalledWith(account(), "0xlocalhash",
      expect.objectContaining({ submittedAt: 1_700_000_000_000 }));
  });

  it("retains exact recovered trade evidence when later settlement reads lose the fill", async () => {
    const result = Object.assign(new BetResult("Polymarket", false), { pending: true,
      orderId: "0xlocalhash", pmSubmitUnknown: true, pmSubmittedAt: 1_700_000_000_000 });
    fetchPolymarketConfirmedTradeForOrder.mockResolvedValueOnce({ id: "trade", size: "10", price: "0.5", status: "CONFIRMED" });
    settlePolymarketDelayedOrder.mockResolvedValue({ outcome: "timeout", row: null });
    const outcome = await resolvePolymarketLegOutcome(account(), result, { fetchVenueOrders });
    expect(outcome.settlement).toBe("filled");
    expect(result.reject).toBeFalsy();
    expect(result.pending).toBe(false);
  });

  it("recovered partial quantities cannot become timeout rejection when subsequent reads are empty", async () => {
    const result = Object.assign(new BetResult("Polymarket", false), { pending: true,
      orderId: "0xlocalhash", pmSubmitUnknown: true, pmSubmittedAt: 1_700_000_000_000 });
    readPolymarketOrderWatch.mockReturnValueOnce({ outcome: "matched", row: { id: "0xlocalhash", status: "matched", size_matched: "3", original_size: "10" } });
    settlePolymarketDelayedOrder.mockResolvedValue({ outcome: "timeout", row: null });
    const outcome = await resolvePolymarketLegOutcome(account(), result, { fetchVenueOrders });
    expect(outcome.settlement).toBe("timeout");
    expect(result.reject).toBeFalsy();
    expect(result.pending).toBe(true);
  });

  it("fallback settle fetches sd from pmConditionId when job ctx missing", async () => {
    const result = Object.assign(new BetResult("Polymarket", true), {
      pending: true,
      orderId: "0xcond",
    });
    settlePolymarketDelayedOrder.mockResolvedValue({ outcome: "unfilled", row: null });

    await resolvePolymarketLegOutcome(
      account(),
      result,
      { fetchVenueOrders },
      "0xcondition",
    );

    expect(resolvePolymarketDelayedPollOpts).toHaveBeenCalledWith("0xcondition");
  });
});
