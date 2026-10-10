import type { GtcPlan } from "@changmen/shared/pm_gtc";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildPreparedGtcBuy, gtcTradeFills, readGtcFacts } from "./index";

const mocks = vi.hoisted(() => ({ market: vi.fn(), getOrder: vi.fn(), trades: vi.fn(), submit: vi.fn(), build: vi.fn(), consume: vi.fn(), json: vi.fn() }));
vi.mock("../userWs", () => ({ warmPolymarketUserWs: vi.fn() }));
const preparation = () => ({ data: { apiBetMoney: 5, limitPrice: 0.5, tokenId: "token", orderOptions: { tickSize: "0.01", minOrderSize: 5, version: 2, negRisk: false } }, runtime: { builder: { buildOrder: mocks.build }, clob: { isV2Order: () => true, Side: { BUY: "BUY" }, OrderType: { GTC: "GTC" }, orderToJsonV2: mocks.json }, builderCode: "builder" }, consume: mocks.consume, validate: () => {} });
const prepareGtcBuy = (account: Parameters<typeof buildPreparedGtcBuy>[0], option: Parameters<typeof buildPreparedGtcBuy>[1]) => buildPreparedGtcBuy(account, option, preparation() as never);
vi.mock("../transport", () => ({ polymarketPluginGet: mocks.market, polymarketL2Get: mocks.trades }));
vi.mock("../pmClientApi", () => ({ pmSubmitOrder: mocks.submit, pmGetOrder: mocks.getOrder, pmCancelOrder: vi.fn() }));
vi.mock("../pmSubmitJournal", () => ({ pmSignedOrderHash: () => "order", pmSubmitMaker: () => "maker" }));
vi.mock("../pmOrderSubmitMode", () => ({ resolvePmOrderSubmitHttpMode: () => "direct" }));
vi.mock("../l2Auth", () => ({ parseTokenConfig: () => ({}), resolveApiCreds: () => ({ apiKey: "api" }) }));
const plan = { tokenId: "token", shares: "10", feeProof: { rate: "0.1", exponent: 1, takerOnly: true, observedAt: 1 } } as GtcPlan;
const trade = { id: "t", taker_order_id: "other", asset_id: "token", side: "SELL", size: "100", price: "0.6", status: "CONFIRMED", last_update: "1000", maker_orders: [{ order_id: "order", asset_id: "token", side: "BUY", matched_amount: "3", price: "0.5" }, { order_id: "unrelated", asset_id: "token", side: "BUY", matched_amount: "97", price: "0.5" }] };
beforeEach(() => { vi.clearAllMocks(); mocks.market.mockResolvedValue({ fd: { r: 0, e: 1, to: true } }); mocks.build.mockResolvedValue({ makerAmount: "4995000", takerAmount: "9990000" }); mocks.json.mockReturnValue({ orderType: "GTC", order: {} }); });
describe("isolated GTC adapter", () => {
  it("uses only exact maker order matched_amount and zero maker fee", () => {
    const fills = gtcTradeFills(trade, plan, "order"); expect(fills).toHaveLength(1);
    expect(fills[0]).toMatchObject({ role: "MAKER", shares: "3", fee: "0", key: "t:order" });
  });
  it("taker uses own size and strictly confirmed market fee proof", () => {
    const fills = gtcTradeFills({ ...trade, taker_order_id: "order", side: "BUY", size: "2", fee_rate_bps: "1000", maker_orders: [] }, plan, "order");
    expect(fills[0]).toMatchObject({ role: "TAKER", shares: "2", fee: "0.048" });
  });
  it.each(["0", "1000", undefined])("uses the confirmed market fee rather than legacy trade bps %s", (fee_rate_bps) => {
    const fills = gtcTradeFills({ ...trade, taker_order_id: "order", side: "BUY", size: "9.29", price: "0.78", fee_rate_bps, maker_orders: [] }, { ...plan, feeProof: { ...plan.feeProof, rate: "0.05" } }, "order");
    expect(fills[0]?.fee).toBe("0.07971");
  });
  it("does not assume zero taker fees without a valid market proof", () => {
    const fills = gtcTradeFills({ ...trade, taker_order_id: "order", side: "BUY", size: "2", maker_orders: [] }, { ...plan, feeProof: undefined } as unknown as GtcPlan, "order");
    expect(fills[0]?.fee).toBeNull();
  });
  it("rejects foreign asset or side even when order id matches", () => {
    expect(() => gtcTradeFills({ ...trade, maker_orders: [{ ...trade.maker_orders[0]!, side: "SELL" }] }, plan, "order")).toThrow();
  });
  it("builds a fixed-size GTC with postOnly=false; never sends during preparation", async () => {
    const prepared = await prepareGtcBuy({} as never, { betId: "condition" } as never);
    expect(mocks.build).toHaveBeenCalledWith(expect.objectContaining({ size: 9.99 }), expect.anything(), 2);
    expect(mocks.json).toHaveBeenCalledWith(expect.anything(), "api", "GTC", false, false);
    expect(mocks.submit).not.toHaveBeenCalled(); expect(mocks.consume).not.toHaveBeenCalled();
    await prepared.submit(); expect(mocks.consume).toHaveBeenCalledTimes(1); expect(mocks.submit).toHaveBeenCalledTimes(1);
  });
  it("missing fee proof fails before signing or sending", async () => {
    mocks.market.mockResolvedValue({}); await expect(prepareGtcBuy({} as never, { betId: "condition" } as never)).rejects.toThrow("费率");
    expect(mocks.build).not.toHaveBeenCalled(); expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("missing order is not interpreted as rejected or zero", async () => {
    mocks.getOrder.mockResolvedValue(null); mocks.trades.mockResolvedValue({ data: [], next_cursor: "LTE=" });
    expect(await readGtcFacts({} as never, plan, "order", 1)).toMatchObject({ order: null, fills: [], complete: false, error: "GTC 本次原单查询未返回记录" });
  });
  it.each([null, new Error("order read timeout")])("full confirmed exact-order trades remain verifiable when order read returns %s", async (result) => {
    if (result instanceof Error)
      mocks.getOrder.mockRejectedValue(result);
    else mocks.getOrder.mockResolvedValue(result);
    mocks.trades.mockResolvedValue({ data: [{ ...trade, taker_order_id: "order", side: "BUY", size: "10", maker_orders: [] }], next_cursor: "LTE=" });
    const facts = await readGtcFacts({} as never, plan, "order", 1);
    expect(facts).toMatchObject({ complete: true, order: { id: "order", original: "10", matched: "10", status: "MATCHED", source: "confirmed-trades" } });
    expect(facts.error).toBeUndefined(); expect(facts.fills[0]?.fee).toBe("0.24");
  });
  it.each(["MATCHED", "MINED", "FAILED"])("does not infer terminal full confirmation from %s trades", async (status) => {
    mocks.getOrder.mockResolvedValue(null);
    mocks.trades.mockResolvedValue({ data: [{ ...trade, taker_order_id: "order", side: "BUY", size: "10", status, maker_orders: [] }], next_cursor: "LTE=" });
    expect(await readGtcFacts({} as never, plan, "order", 1)).toMatchObject({ order: null, complete: false });
  });
  it("keeps confirmed partial fills while a missing order still leaves remainder unknown", async () => {
    mocks.getOrder.mockResolvedValue(null); mocks.trades.mockResolvedValue({ data: [trade], next_cursor: "LTE=" });
    const facts = await readGtcFacts({} as never, plan, "order", 1);
    expect(facts.complete).toBe(false); expect(facts.fills[0]?.shares).toBe("3"); expect(facts.order).toBeNull();
  });
  it("queries every page and ignores unrelated orders", async () => {
    mocks.getOrder.mockResolvedValue({ id: "order", asset_id: "token", side: "BUY", original_size: "10", size_matched: "3", status: "LIVE", associate_trades: ["t"] });
    mocks.trades.mockResolvedValueOnce({ data: [], next_cursor: "next" }).mockResolvedValueOnce({ data: [trade], next_cursor: "LTE=" });
    const result = await readGtcFacts({} as never, plan, "order", 100000);
    expect(mocks.trades).toHaveBeenCalledTimes(2); expect(result.complete).toBe(true); expect(result.fills[0]?.shares).toBe("3");
  });
  it("repeating cursor does not silently truncate trades", async () => {
    mocks.getOrder.mockResolvedValue({ id: "order", asset_id: "token", side: "BUY", status: "LIVE" }); mocks.trades.mockResolvedValue({ data: [], next_cursor: "MA==" });
    await expect(readGtcFacts({} as never, plan, "order", 1)).rejects.toThrow("游标重复");
  });
});
