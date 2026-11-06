import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mapPolymarketSellTradeToVenueOrder, mapPolymarketTradeToVenueOrder } from "../../../../polymarket/orders/history/orderTradeMapping";
import type { PolymarketTradeRow } from "../../../../polymarket/orders/history/orderTradeTypes";
import type { PolymarketRawMarket } from "../../../../polymarket/markets/parse";

const condition = "0x" + "a".repeat(64);
function trade(overrides: PolymarketTradeRow = {}): PolymarketTradeRow {
  return Object.freeze({ taker_order_id: " order-1 ", market: condition, asset_id: "101", size: "10", price: ".4", match_time: "100", outcome: "Home", ...overrides });
}
function market(version: "v1" | "v2", payout?: 0 | 0.5 | 1): PolymarketRawMarket {
  const ids = version === "v1" ? ["101", "102"] : ["201", "202"];
  return Object.freeze({ version, conditionId: condition, question: "CS2: Home vs Away - Map 2 Winner", groupItemTitle: "Map 2 Winner",
    outcomes: ["Home", "Away"], clobTokenIds: '["101","102"]', ...(version === "v2" ? { positionIds: ids } : {}),
    ...(payout === undefined ? {} : { closed: true, tokens: ids.map((token_id, index) => ({ token_id, winner: payout === 0.5 ? false : index === (payout === 1 ? 0 : 1) })),
      ...(payout === 0.5 ? { finalResolution: { condition_id: condition, status: "resolved", payouts: [500000, 500000] } } : {}) }),
  });
}
const forbidden = vi.fn(() => { throw Error("Trade mapping accessed external state"); });
beforeEach(() => {
  forbidden.mockClear();
  vi.stubGlobal("fetch", forbidden);
  vi.stubGlobal("localStorage", { getItem: forbidden, setItem: forbidden });
});
afterEach(() => { expect(forbidden).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("trade to order field contract", () => {
  it("maps BUY shares, cost, odds and timestamps in USDC before display conversion", () => {
    expect(mapPolymarketTradeToVenueOrder(trade(), market("v1"))).toEqual({
      provider: "Polymarket", orderId: "order-1", odds: 2.5, createAt: 100000, betMoney: 4, reward: 10, money: 0, status: "none",
      game: "cs2", match: "CS2: Home vs Away - Map 2 Winner", bet: "地图2", item: "Home", pmTokenId: "101", pmShares: 10,
      pmFillPrice: 0.4, pmStakeUsdc: 4, pmConditionId: condition, pmSide: "buy", pmSellState: "open",
    });
  });
  it("maps SELL proceeds without inventing a cost basis or realized profit", () => {
    expect(mapPolymarketSellTradeToVenueOrder(trade({ side: "SELL", size: "2.345678", price: ".7" }), market("v1", 1)))
      .toMatchObject({ orderId: "order-1", pmSide: "sell", pmOrigin: "external", pmShares: 2.345678, pmFillPrice: 0.7,
        betMoney: 1.642, pmStakeUsdc: 0, reward: 0, money: 0, status: "none", item: "平仓 Home" });
  });
  it.each([mapPolymarketTradeToVenueOrder, mapPolymarketSellTradeToVenueOrder])("retains fractional and million-share GET fills", map => {
    expect(map(trade({ size: "1000000.123456" }))).toMatchObject({ pmShares: 1000000.123456, betMoney: 400000.0494 });
    expect(map(trade({ size: "2.345678" }))).toMatchObject({ pmShares: 2.345678, betMoney: 0.9383 });
  });
  it.each([0, 1, -1, "invalid", Infinity])("rejects non-tradable entry price %s for both sides", price => {
    expect(mapPolymarketTradeToVenueOrder(trade({ price }))).toBeNull();
    expect(mapPolymarketSellTradeToVenueOrder(trade({ price }))).toBeNull();
  });
  it.each([0, -10, "invalid", Infinity])("rejects unusable share amounts %s for both sides", size => {
    expect(mapPolymarketTradeToVenueOrder(trade({ size }))).toBeNull();
    expect(mapPolymarketSellTradeToVenueOrder(trade({ size }))).toBeNull();
  });
  it("keeps existing ID and label fallbacks without reading caches", () => {
    expect(mapPolymarketTradeToVenueOrder(trade({ taker_order_id: undefined, id: "fallback" })))
      .toMatchObject({ orderId: "fallback", match: `${condition.slice(0, 10)}…`, game: "", bet: "" });
    expect(mapPolymarketTradeToVenueOrder(trade({ taker_order_id: "", id: "fallback" }))).toBeNull();
    expect(mapPolymarketSellTradeToVenueOrder(trade({ outcome: "", market: "", asset_id: "", match_time: undefined })))
      .toMatchObject({ item: "平仓", match: "", createAt: 0, pmTokenId: undefined, pmConditionId: undefined });
  });
});

for (const version of ["v1", "v2"] as const) describe(`${version} protocol-specific assets and settlement`, () => {
  const asset = version === "v1" ? "101" : "201";
  it.each([[1, "win", 6, 10], [0, "lose", -4, 0], [0.5, "win", 1, 5]] as const)("maps final payout %s independently from financial result", (payout, status, money, reward) => {
    const input = trade({ asset_id: asset });
    const result = mapPolymarketTradeToVenueOrder(input, market(version, payout));
    expect(result).toMatchObject({ status, money, reward, pmTokenId: asset, pmMatchResult: payout === 0.5 ? "equal_split" : status, pmSellState: "settled" });
    expect(result?.pmSettlement).toMatchObject({ price: payout });
    expect(input.price).toBe(".4");
  });
  it("resolves missing held asset from outcome using the protocol's official asset list", () => {
    expect(mapPolymarketTradeToVenueOrder(trade({ asset_id: undefined }), market(version, 1)))
      .toMatchObject({ pmTokenId: asset, status: "win", money: 6 });
  });
  it("does not apply another market's final payout or an unrelated asset", () => {
    const resolved = market(version, 1);
    expect(mapPolymarketTradeToVenueOrder(trade({ asset_id: asset, market: "different-condition" }), resolved))
      .toMatchObject({ status: "none", money: 0, pmSellState: "open" });
    expect(mapPolymarketTradeToVenueOrder(trade({ asset_id: "unrelated" }), resolved))
      .toMatchObject({ status: "none", money: 0, pmSellState: "open" });
  });
});
