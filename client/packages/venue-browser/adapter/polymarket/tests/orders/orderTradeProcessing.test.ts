import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeEthAddress } from "../../../../polymarket/ethAddress";
import { aggregatePolymarketSellTrades, aggregatePolymarketTrades, collectPolymarketOrderTxHashes, flattenPolymarketTrades, isPolymarketTradeConfirmed, isUserMakerOrderLeg, polymarketTradeRefsOrderId } from "../../../../polymarket/orders/history/orderTradeProcessing";
import type { PolymarketTradeRow } from "../../../../polymarket/orders/history/orderTradeTypes";

const ownAddress = "0x" + "a".repeat(40);
const otherAddress = "0x" + "b".repeat(40);
const own = new Set([ownAddress]);
function row(overrides: PolymarketTradeRow = {}): PolymarketTradeRow {
  return { id: "trade-1", taker_order_id: "order-1", side: "BUY", status: "CONFIRMED", size: "10", price: ".4", match_time: "100", owner: "api-owner", ...overrides };
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
const forbidden = vi.fn(() => { throw Error("Trade processing accessed external state"); });
beforeEach(() => {
  forbidden.mockClear();
  vi.stubGlobal("fetch", forbidden);
  vi.stubGlobal("localStorage", { getItem: forbidden, setItem: forbidden });
});
afterEach(() => { expect(forbidden).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("maker ownership and trade identity", () => {
  it("normalizes valid addresses and rejects malformed ones without changing the address set", () => {
    expect(normalizeEthAddress(`  ${ownAddress.toUpperCase()} `)).toBe(ownAddress);
    for (const raw of [undefined, null, "", "0x123", "0x" + "g".repeat(40)]) expect(normalizeEthAddress(raw)).toBe("");
    expect(isUserMakerOrderLeg({ maker_address: ownAddress.toUpperCase(), owner: "different-owner" }, row(), own)).toBe(true);
    // An explicit opponent address wins over a matching API owner.
    expect(isUserMakerOrderLeg({ maker_address: otherAddress, owner: "api-owner" }, row(), own)).toBe(false);
    expect([...own]).toEqual([ownAddress]);
  });
  it("uses owner only when no valid maker address exists; missing ownership is rejected", () => {
    expect(isUserMakerOrderLeg({ maker_address: "invalid", owner: " api-owner " }, row(), own)).toBe(true);
    expect(isUserMakerOrderLeg({ owner: "API-OWNER" }, row(), own)).toBe(false);
    expect(isUserMakerOrderLeg({}, row(), own)).toBe(false);
    expect(isUserMakerOrderLeg({ owner: "api-owner" }, row({ owner: "" }), own)).toBe(false);
  });
  it("retains the existing unfiltered behavior when no addresses are supplied", () => {
    expect(isUserMakerOrderLeg({ maker_address: otherAddress }, row())).toBe(true);
    expect(isUserMakerOrderLeg({}, row(), new Set())).toBe(true);
  });
  it("expands only owned maker fills and uses leg price, side, shares, outcome and asset", () => {
    const raw = freeze([row({ trader_side: "MAKER", maker_orders: [
      { order_id: " own-order ", maker_address: ownAddress, matched_amount: "2.345678", price: ".7", side: "SELL", outcome: "Away", asset_id: "202" },
      { order_id: "opponent-order", maker_address: otherAddress, matched_amount: "1000" },
      { order_id: " ", maker_address: ownAddress, matched_amount: "999" },
    ] })]);
    expect(flattenPolymarketTrades(raw, own)).toEqual([{ ...raw[0], taker_order_id: "own-order", size: "2.345678", price: ".7", side: "SELL", outcome: "Away", asset_id: "202" }]);
    expect(raw[0].taker_order_id).toBe("order-1");
  });
  it("never turns an opponent-only maker trade into the taker order", () => {
    expect(flattenPolymarketTrades([row({ type: "MAKER", maker_orders: [{ order_id: "opponent", maker_address: otherAddress }] })], own)).toEqual([]);
  });
  it("preserves maker field fallback and the original taker object", () => {
    const maker = row({ type: "MAKER", asset_id: "101", outcome: "Home", maker_orders: [{ order_id: "own", owner: "api-owner" }] });
    const taker = row({ trader_side: "TAKER", maker_orders: [{ order_id: "opponent", maker_address: otherAddress }] });
    const result = flattenPolymarketTrades(freeze([maker, taker, row({ taker_order_id: "" })]), own);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ taker_order_id: "own", price: ".4", size: "10", asset_id: "101", outcome: "Home", side: "BUY" });
    expect(result[1]).toBe(taker);
  });
  it("finds taker or maker IDs without requiring a confirmed or owned trade", () => {
    const trade = freeze(row({ taker_order_id: " TAKER ", status: "FAILED", maker_orders: [{ order_id: " MAKER " }] }));
    expect(polymarketTradeRefsOrderId(trade, "taker")).toBe(true);
    expect(polymarketTradeRefsOrderId(trade, " maker ")).toBe(true);
    expect(polymarketTradeRefsOrderId(trade, "missing")).toBe(false);
    expect(polymarketTradeRefsOrderId(trade, " ")).toBe(false);
  });
  it("collects valid unique transaction hashes by normalized order ID", () => {
    const tx1 = "0x" + "a".repeat(64), tx2 = "0x" + "b".repeat(64);
    expect([...collectPolymarketOrderTxHashes(freeze([
      row({ taker_order_id: " ORDER-1 ", transaction_hash: tx1.toUpperCase() }),
      row({ transaction_hash: tx1 }), row({ transaction_hash: tx2 }),
      row({ transaction_hash: "invalid" }), row({ taker_order_id: "", transaction_hash: tx1 }),
    ]))]).toEqual([["order-1", [tx1, tx2]]]);
    expect(collectPolymarketOrderTxHashes(null).size).toBe(0);
  });
});

describe("confirmed trade aggregation", () => {
  it.each(["CONFIRMED", "TRADE_STATUS_MATCHED", " mined ", "RETRYING"])("retains existing inclusion of %s", status => {
    expect(isPolymarketTradeConfirmed(status)).toBe(true);
  });
  it.each([undefined, "", "PENDING", "FAILED", "CANCELLED", "CONFIRMED_FAILED", "MATCHED_CANCEL"])("excludes %s", status => {
    expect(isPolymarketTradeConfirmed(status)).toBe(false);
  });
  it.each(["BUY", "SELL"])("%s conserves fill shares and computes VWAP independent of bucket order", side => {
    const input = freeze([
      row({ side, size: "10", price: ".2", match_time: "300" }),
      row({ side, size: "30", price: ".6", match_time: "100" }),
      row({ side, size: "20", price: ".5", match_time: "200" }),
    ]);
    const aggregate = side === "BUY" ? aggregatePolymarketTrades : aggregatePolymarketSellTrades;
    const [forward] = aggregate(input), [reverse] = aggregate([...input].reverse());
    expect(forward).toMatchObject({ size: "60", price: "0.5", match_time: "300" });
    expect(reverse).toMatchObject({ size: forward.size, price: forward.price, match_time: forward.match_time });
    expect(input[0].size).toBe("10");
    expect(forward).not.toHaveProperty("_sizeSum");
    expect(forward).not.toHaveProperty("_notionalSum");
  });
  it.each(["BUY", "SELL"])("%s ignores failed, canceled, opposite-side and unidentified rows", side => {
    const aggregate = side === "BUY" ? aggregatePolymarketTrades : aggregatePolymarketSellTrades;
    const result = aggregate(freeze([
      row({ side }), row({ side, status: "FAILED" }), row({ side, status: "CANCELLED" }),
      row({ side: side === "BUY" ? "SELL" : "BUY" }), row({ side, taker_order_id: " " }),
      row({ side, taker_order_id: "second", size: "20", price: ".3", match_time: "400" }),
    ]));
    expect(result.map(trade => [trade.taker_order_id, trade.size, trade.price])).toEqual([["order-1", "10", "0.4"], ["second", "20", "0.3"]]);
  });
  it("preserves the distinct BUY and SELL rounding stages for fractional fills", () => {
    // Two 0.012345-share fills cost 0.004938 before rounding. SELL rounds each leg.
    const input = freeze([row({ size: "0.012345", price: ".4" }), row({ size: "0.012345", price: ".6" })]);
    expect(aggregatePolymarketTrades(input)[0]).toMatchObject({ size: "0.02469", price: "0.5" });
    expect(aggregatePolymarketSellTrades(input.map(trade => ({ ...trade, side: "SELL" })))[0])
      .toMatchObject({ size: "0.02469", price: "0.498177" });
  });
  it("does not apply micro-unit conversion to large normalized GET fills", () => {
    const [result] = aggregatePolymarketTrades(freeze([row({ size: "1000000", price: ".4" }), row({ size: "0.123456", price: ".4" })]));
    expect(result).toMatchObject({ size: "1000000.123456", price: "0.4" });
  });
});
