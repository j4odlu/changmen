import { beforeEach, describe, expect, it, vi } from "vitest";
const getTrades = vi.hoisted(() => vi.fn());
vi.mock("./pmClientApi", () => ({ pmGetTrades: getTrades }));
import { fetchPolymarketConfirmedTradeForOrder } from "./orders";
import { interpretPolymarketOrderRow, applyPolymarketBuyTimeoutPolicy, applyPolymarketSettlementToResult } from "./orderStatus";
import { BetResult } from "@changmen/client-core/models/betResult";
import { polymarketFailedBuyTradeRow } from "./tradeFailure";

const account = { provider: "Polymarket", accountId: 1, token: "{}" } as never;
const failed = { id: "trade-1", taker_order_id: "order-1", side: "BUY", status: "FAILED", size: "10" };
beforeEach(() => getTrades.mockReset());

describe("sole BUY FOK failed trade", () => {
  it("retains the official failure basis through order interpretation and rejection display", () => {
    const row = polymarketFailedBuyTradeRow(failed, "ORDER-1")!;
    expect(interpretPolymarketOrderRow(row)).toBe("unfilled");
    const settled = applyPolymarketBuyTimeoutPolicy({ outcome: "unfilled", row });
    expect(settled.row?.confirmationBasis).toBe("trade_failed");
    const result = Object.assign(new BetResult("Polymarket", true), { orderId: "order-1", pending: true });
    applyPolymarketSettlementToResult(result, settled.outcome, settled.row);
    expect(result).toMatchObject({ pending: false, reject: "unfilled" });
    expect(result.message).toContain("官方 trade FAILED（trade-1）");
    expect(result.message).not.toContain("核验耗尽");
  });

  it.each([
    { ...failed, id: "" }, { ...failed, side: "SELL" },
    { ...failed, taker_order_id: "other" }, { ...failed, status: "RETRYING" },
  ])("does not reject on incomplete, unrelated or nonterminal evidence: %j", (trade) => {
    expect(polymarketFailedBuyTradeRow(trade, "order-1")).toBeNull();
  });

  it("only exposes FAILED to the opted-in BUY rejection lookup", async () => {
    getTrades.mockResolvedValue([failed]);
    expect(await fetchPolymarketConfirmedTradeForOrder(account, "order-1")).toBeNull();
    expect(await fetchPolymarketConfirmedTradeForOrder(account, "order-1", 600_000, "BUY", true, true)).toEqual(failed);
    expect(await fetchPolymarketConfirmedTradeForOrder(account, "order-1", 600_000, "SELL", true, true)).toBeNull();
  });

  it("counts tradeIds rather than maker legs or duplicate records", async () => {
    const trade = { ...failed, maker_orders: [{ order_id: "maker-1" }, { order_id: "maker-2" }] };
    getTrades.mockResolvedValue([trade, trade]);
    expect(await fetchPolymarketConfirmedTradeForOrder(account, "order-1", 600_000, "BUY", true, true)).toEqual(trade);
  });

  it("does not apply the sole-trade rule when another tradeId exists", async () => {
    getTrades.mockResolvedValue([failed, { ...failed, id: "trade-2", status: "CONFIRMED" }]);
    expect((await fetchPolymarketConfirmedTradeForOrder(account, "order-1", 600_000, "BUY", true, true))?.id).toBe("trade-2");
  });

  it("preserves CONFIRMED when the response repeats the same tradeId with conflicting statuses", async () => {
    getTrades.mockResolvedValue([failed, { ...failed, status: "CONFIRMED" }]);
    expect((await fetchPolymarketConfirmedTradeForOrder(account, "order-1", 600_000, "BUY", true, true))?.status).toBe("CONFIRMED");
  });

  it("does not interpret a maker-only FAILED as this taker FOK's failure", async () => {
    getTrades.mockResolvedValue([{ ...failed, taker_order_id: "other", maker_orders: [{ order_id: "order-1" }] }]);
    expect(await fetchPolymarketConfirmedTradeForOrder(account, "order-1", 600_000, "BUY", true, true)).toBeNull();
  });
});
