import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VenueOrder } from "@changmen/client-core/contract";
import type { PolymarketRawMarket } from "../../../../polymarket/markets/parse";
import { updateStoredPolymarketOrderFromClob, updateStoredPolymarketOrderFromMarket } from "../../../../polymarket/orders/history/orderSyncUpdate";
import { reconcilePolymarketBuySellOrders } from "../../../../polymarket/orders/history/orderSellAttribution";
import { parsePolymarketBuyOrderFill, polymarketTradeFillAmounts } from "../../../../polymarket/orders/history/orderTradeAmounts";

const condition = "0x" + "a".repeat(64);
const forbidden = vi.fn(() => { throw Error("Snapshot calculation accessed external state"); });
beforeEach(() => {
  forbidden.mockClear();
  vi.stubGlobal("fetch", forbidden);
  vi.stubGlobal("localStorage", { getItem: forbidden, setItem: forbidden });
});
afterEach(() => { expect(forbidden).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

function snapshots(version: "v1" | "v2", cost = 40) {
  const ids = version === "v1" ? ["101", "102"] : ["201", "202"];
  const order: VenueOrder = { provider: "Polymarket", orderId: "original", pmOrigin: "changmen", pmSide: "buy",
    pmTokenId: ids[0], pmConditionId: condition, pmShares: 100, pmFillPrice: cost / 100, pmStakeUsdc: cost,
    pmFeeUsdc: 0.1, betMoney: cost * 6.7, money: 0, reward: 0, status: "none", pmSellState: "open",
    odds: 100 / cost, createAt: 123, game: "csgo", match: "Home vs Away", bet: "地图1", item: "Home", link: 456 };
  const market: PolymarketRawMarket = { version, conditionId: condition,
    ...(version === "v2" ? { positionIds: ids, clobTokenIds: '["101","102"]' } : { clobTokenIds: JSON.stringify(ids) }),
    closed: true, tokens: ids.map((token_id, index) => ({ token_id, winner: index === 0 })) };
  return { order, market };
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function persist(order: VenueOrder): VenueOrder {
  return { ...order, betMoney: order.betMoney * 6.7, money: order.money * 6.7, reward: order.reward * 6.7 };
}
function resultMarket(market: PolymarketRawMarket, outcome: "win" | "lose" | "equal_split"): PolymarketRawMarket {
  if (outcome === "equal_split") return { ...market, tokens: undefined, outcomePrices: '["0.5","0.5"]',
    finalResolution: { condition_id: condition, status: "resolved", payouts: [500000, 500000] } };
  return { ...market, tokens: market.tokens!.map((token, index) => ({ ...token, winner: index === (outcome === "win" ? 0 : 1) })) };
}

for (const version of ["v1", "v2"] as const) {
  describe(`${version} order snapshot updates`, () => {
    it.each([["win", 60, 100], ["lose", -40, 0], ["equal_split", 10, 50]] as const)(
      "applies final %s with fee-inclusive original cost and keeps grouping", (outcome, money, reward) => {
        const { order, market } = snapshots(version);
        const updated = updateStoredPolymarketOrderFromMarket(freeze(order), freeze(resultMarket(market, outcome)), "");
        expect(updated).toMatchObject({ orderId: "original", betMoney: 40, money, reward,
          pmMatchResult: outcome, pmSellState: "settled", link: 456, createAt: 123 });
        expect(updated.pmSettlement?.price).toBe(outcome === "equal_split" ? 0.5 : outcome === "win" ? 1 : 0);
        expect(order.money).toBe(0);
        // reward is rebuilt by the DTO/fee stages. Verify the persisted financial
        // facts and finality here rather than equating every intermediate field.
        expect(updateStoredPolymarketOrderFromMarket(persist(updated), market, "")).toMatchObject({
          money: updated.money, betMoney: updated.betMoney, status: updated.status,
          pmSettlement: updated.pmSettlement, pmMatchResult: updated.pmMatchResult, pmShares: 100,
        });
      });

    it.each([[40, 10, "win"], [50, 0, "return"], [60, -10, "lose"]] as const)(
      "half payout with cost %s preserves actual profit %s and financial status %s", (cost, money, status) => {
        const { order, market } = snapshots(version, cost);
        expect(updateStoredPolymarketOrderFromMarket(freeze(order), resultMarket(market, "equal_split"), ""))
          .toMatchObject({ money, status, pmMatchResult: "equal_split" });
      });

    it.each([["win", 32], ["lose", -28], ["equal_split", 2]] as const)(
      "partial sale plus final %s is idempotent and does not add earlier paper profit twice", (outcome, money) => {
        const { order, market } = snapshots(version);
        const partial: VenueOrder = { ...order, pmAttributedSellShares: 40, pmStakeUsdc: 24,
          pmRealizedPnlUsdc: -4, pmSellProceeds: 12, money: -4 * 6.7, pmSellState: "partial" };
        const finalMarket = freeze(resultMarket(market, outcome));
        const updated = updateStoredPolymarketOrderFromMarket(freeze(partial), finalMarket, "");
        expect(updated).toMatchObject({ money, pmRealizedPnlUsdc: -4, pmAttributedSellShares: 40, pmShares: 100 });
        expect(updateStoredPolymarketOrderFromMarket(persist(updated), finalMarket, "")).toMatchObject({
          money, betMoney: updated.betMoney, pmRealizedPnlUsdc: -4, pmAttributedSellShares: 40,
          status: updated.status, pmSettlement: updated.pmSettlement,
        });
      });

    it.each(["win", "lose", "equal_split"] as const)("fully sold order keeps realized money with market %s", outcome => {
      const { order, market } = snapshots(version);
      const closed: VenueOrder = { ...order, pmAttributedSellShares: 100, pmStakeUsdc: 0, pmSellState: "closed", money: 17 * 6.7 };
      expect(updateStoredPolymarketOrderFromMarket(freeze(closed), resultMarket(market, outcome), ""))
        .toMatchObject({ money: 17, pmSellState: "closed", pmMatchResult: outcome });
    });

    it("uses the passed label and keeps stored identity, fee-inclusive cost and link on a fill refresh", () => {
      const { order } = snapshots(version);
      const fresh = { ...order, pmOrigin: "external" as const, pmShares: 99, betMoney: 39.9, pmStakeUsdc: 39.9, link: 999, bet: "old API label" };
      const updated = updateStoredPolymarketOrderFromClob(freeze(order), freeze(fresh), "地图2");
      expect(updated).toMatchObject({ bet: "地图2", pmShares: 100, betMoney: 40, pmStakeUsdc: 40,
        pmOrigin: "changmen", link: 456, orderId: "original" });
    });

    it("does not treat a live 0.5 quote, wrong condition or unrelated asset as final", () => {
      const { order, market } = snapshots(version);
      const cases: PolymarketRawMarket[] = [
        { ...market, tokens: undefined, outcomePrices: '["0.5","0.5"]' },
        { ...market, conditionId: "other" },
        { ...market, tokens: [{ token_id: "other", winner: true }] },
      ];
      for (const snapshot of cases)
        expect(updateStoredPolymarketOrderFromMarket(freeze(order), snapshot, "")).toMatchObject({ status: "none", money: 0 });
    });
  });
}

it("external sale attribution leaves input snapshots untouched and books profit on the buy once", () => {
  const buy: VenueOrder = { ...snapshots("v1").order, pmOrigin: "external", betMoney: 40 };
  const sell: VenueOrder = { ...buy, orderId: "sale", pmSide: "sell", pmShares: 40, odds: 1 / 0.3,
    betMoney: 12, createAt: 456, pmStakeUsdc: 0, money: 0 };
  const result = reconcilePolymarketBuySellOrders(freeze([buy, sell]));
  expect(result.find(row => row.orderId === "original")).toMatchObject({ money: -4, pmStakeUsdc: 24,
    pmAttributedSellShares: 40, pmShares: 100, pmSellState: "partial" });
  expect(result.find(row => row.orderId === "sale")).toMatchObject({ money: 0, pmBuyOrderId: "original", betMoney: 12 });
  expect(buy.pmAttributedSellShares).toBeUndefined();
});

it("fill snapshots keep POST micro units separate from normalized trade amounts", () => {
  expect(parsePolymarketBuyOrderFill({ makingAmount: "40000000", takingAmount: "100000000" })).toEqual({ stakeUsdc: 40, shares: 100 });
  expect(polymarketTradeFillAmounts({ size: "1000000", price: "0.4" })).toEqual({ shares: 1000000, usdc: 400000 });
});
