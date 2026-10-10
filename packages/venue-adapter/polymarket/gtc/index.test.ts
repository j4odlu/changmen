import type { GtcPlan } from "@changmen/shared/pm_gtc";
import { createGtcExecution, gtcCanCancel, mergeGtcFacts } from "@changmen/shared/pm_gtc";
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
const plan = { tokenId: "token", conditionId: "condition", shares: "10", feeProof: { rate: "0.1", exponent: 1, takerOnly: true, observedAt: 1 } } as GtcPlan;
const trade = { id: "t", taker_order_id: "other", asset_id: "token", side: "SELL", size: "100", price: "0.6", status: "CONFIRMED", last_update: "1000", maker_orders: [{ order_id: "order", asset_id: "token", side: "BUY", matched_amount: "3", price: "0.5" }, { order_id: "unrelated", asset_id: "token", side: "BUY", matched_amount: "97", price: "0.5" }] };
beforeEach(() => { vi.clearAllMocks(); mocks.market.mockResolvedValue({ fd: { r: 0, e: 1, to: true } }); mocks.build.mockImplementation(async ({ size, price }: { size: number; price: number }) => ({ makerAmount: String(Math.round(size * price * 1_000_000)), takerAmount: String(Math.round(size * 1_000_000)) })); mocks.json.mockReturnValue({ orderType: "GTC", order: {} }); });
describe("isolated GTC adapter", () => {
  it("reconciles confirmed maker fills with long ratio prices and a MATCHED rounding remainder", async () => {
    const inputPlan = { ...plan, shares: "29.27", orderHash: "order" };
    const parts = [["3.416735", "0.510000043901561"], ["2.163266", "0.5100001571697609"], ["5", "0.51"], ["18.68", "0.51"]];
    const trades = parts.map(([shares, price], index) => ({ ...trade, id: `t${index}`, maker_orders: [{ ...trade.maker_orders[0]!, matched_amount: shares, price }] }));
    mocks.getOrder.mockResolvedValue({ id: "order", asset_id: "token", side: "BUY", original_size: "29.27", size_matched: "29.260001", status: "MATCHED", associate_trades: trades.map(t => t.id) });
    mocks.trades.mockResolvedValue({ data: trades, next_cursor: "LTE=" });
    const facts = await readGtcFacts({} as never, inputPlan, "order", 1);
    expect(facts.fills[1]?.price).toBe("0.5100001571697609");
    const initial = createGtcExecution("execution", "owner", "wallet", "maker", inputPlan, 1);
    initial.cancel = { commandId: "cancel", state: "failed", message: "order can't be found - already canceled or matched" };
    const row = mergeGtcFacts(initial, facts);
    expect(row).toMatchObject({ matched: "29.260001", principal: "14.9226", fee: "0", complete: true, terminal: true, open: "0", error: "" });
    expect(row.cancel).toMatchObject({ state: "acknowledged", message: "原单已撮合结束，无可取消挂单；已成交部分保留" });
    expect(gtcCanCancel(row)).toBe(false);
    const replay = structuredClone(facts);
    replay.fills[1]!.price += "00";
    expect(mergeGtcFacts(row, replay)).toMatchObject({ principal: "14.9226", matched: "29.260001", error: "" });
    replay.fills[1]!.price = "0.510000157169761";
    expect(mergeGtcFacts(row, replay).error).toContain("价格冲突");
  });
  it.each(["NaN", "-0.5", "5e-1", "", undefined])("rejects malformed fill prices %s", (price) => {
    expect(() => gtcTradeFills({ ...trade, maker_orders: [{ ...trade.maker_orders[0]!, price }] }, plan, "order")).toThrow("成交价格");
  });
  it("uses only exact maker order matched_amount and zero maker fee", () => {
    const fills = gtcTradeFills(trade, plan, "order"); expect(fills).toHaveLength(1);
    expect(fills[0]).toMatchObject({ role: "MAKER", shares: "3", fee: "0", key: "t:order" });
  });
  it("taker uses own size and strictly confirmed market fee proof", () => {
    const fills = gtcTradeFills({ ...trade, taker_order_id: "order", side: "BUY", size: "2", fee_rate_bps: "1000", maker_orders: [] }, plan, "order");
    expect(fills[0]).toMatchObject({ role: "TAKER", shares: "2", fee: "0.048" });
  });
  it.each(["0", "1000", undefined])("uses the confirmed market fee rather than legacy trade bps %s", (fee_rate_bps) => {
    const fills = gtcTradeFills({ ...trade, taker_order_id: "order", side: "BUY", size: "9.29", price: "0.78", fee_rate_bps, maker_orders: [] }, { ...plan, feeProof: { ...plan.feeProof!, rate: "0.05" } }, "order");
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
    expect(mocks.build).toHaveBeenCalledWith(expect.objectContaining({ size: 10 }), expect.anything(), 2);
    expect(prepared).toMatchObject({ shares: "10", maxPrincipal: "5", allInBudget: "5" });
    expect(prepared).not.toHaveProperty("feeProof");
    expect(mocks.market).not.toHaveBeenCalled();
    expect(mocks.json).toHaveBeenCalledWith(expect.anything(), "api", "GTC", false, false);
    expect(mocks.submit).not.toHaveBeenCalled(); expect(mocks.consume).not.toHaveBeenCalled();
    await prepared.submit(); expect(mocks.consume).toHaveBeenCalledTimes(1); expect(mocks.submit).toHaveBeenCalledTimes(1);
  });
  it.each([{}, { fd: { r: 0.5, e: 1, to: true } }, new Error("fee lookup unavailable")])("fee availability or rate does not affect preparation: %s", async (market) => {
    if (market instanceof Error)
      mocks.market.mockRejectedValue(market);
    else mocks.market.mockResolvedValue(market);
    const prepared = await prepareGtcBuy({} as never, { betId: "condition" } as never);
    expect(prepared.shares).toBe("10"); expect(mocks.market).not.toHaveBeenCalled();
    await prepared.submit(); expect(mocks.submit).toHaveBeenCalledOnce();
  });
  it.each([[2.5, 0.5, "5"], [3, 0.6, "5"], [1.29, 0.258, "5"], [2.99, 0.5, "5.98"]])("uses the principal budget %s at limit %s without a fee reserve", async (budget, price, shares) => {
    const input = preparation(); input.data.apiBetMoney = budget as number; input.data.limitPrice = price as number;
    const prepared = await buildPreparedGtcBuy({} as never, { betId: "condition" } as never, input as never);
    expect(prepared.shares).toBe(shares); expect(Number(prepared.maxPrincipal)).toBeLessThanOrEqual(budget as number);
    expect(mocks.market).not.toHaveBeenCalled();
  });
  it("still blocks insufficient principal before signing", async () => {
    const input = preparation(); input.data.apiBetMoney = 2.49;
    await expect(buildPreparedGtcBuy({} as never, {} as never, input as never)).rejects.toThrow("下单金额低于最小份数");
    expect(mocks.build).not.toHaveBeenCalled(); expect(mocks.submit).not.toHaveBeenCalled();
  });
  it.each([{ makerAmount: "5000001", takerAmount: "10000000" }, { makerAmount: "5000000", takerAmount: "9990000" }])("rejects a signed principal or quantity outside the frozen plan", async (signed) => {
    mocks.build.mockResolvedValueOnce(signed);
    await expect(prepareGtcBuy({} as never, {} as never)).rejects.toThrow("预算越界");
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("looks up fees only after its own taker fills and preserves actual financial costs", async () => {
    mocks.market.mockResolvedValue({ fd: { r: 0.05, e: 1, to: true } });
    mocks.getOrder.mockResolvedValue(null);
    mocks.trades.mockResolvedValue({ data: [{ ...trade, taker_order_id: "order", side: "BUY", size: "9.29", price: "0.78", maker_orders: [] }], next_cursor: "LTE=" });
    const facts = await readGtcFacts({} as never, { ...plan, shares: "9.29", feeProof: undefined }, "order", 1);
    expect(facts.fills[0]?.fee).toBe("0.07971"); expect(facts.complete).toBe(true);
    expect(mocks.market).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("/clob-markets/condition"));
  });
  it.each([{}, { fd: { r: 0.05, e: 2, to: true } }, new Error("fee lookup unavailable")])("unknown post-fill fees stay unknown without losing confirmed fills: %s", async (market) => {
    if (market instanceof Error)
      mocks.market.mockRejectedValue(market);
    else mocks.market.mockResolvedValue(market);
    mocks.getOrder.mockResolvedValue(null);
    mocks.trades.mockResolvedValue({ data: [{ ...trade, taker_order_id: "order", side: "BUY", size: "10", maker_orders: [] }], next_cursor: "LTE=" });
    const facts = await readGtcFacts({} as never, { ...plan, feeProof: undefined }, "order", 1);
    expect(facts.fills[0]).toMatchObject({ shares: "10", fee: null, status: "CONFIRMED" });
    expect(facts.complete).toBe(true); expect(mocks.market).toHaveBeenCalledOnce();
  });
  it("maker fills do not require a fee lookup for new orders", async () => {
    mocks.getOrder.mockResolvedValue(null); mocks.trades.mockResolvedValue({ data: [trade], next_cursor: "LTE=" });
    const facts = await readGtcFacts({} as never, { ...plan, feeProof: undefined }, "order", 1);
    expect(facts.fills[0]?.fee).toBe("0"); expect(mocks.market).not.toHaveBeenCalled();
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
