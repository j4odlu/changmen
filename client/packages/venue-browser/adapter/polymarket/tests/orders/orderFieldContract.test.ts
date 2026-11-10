import { expect, it } from "vitest";
import { venueOrderFromOrderRow, type OrderRowLike } from "../../../../polymarket/orders/positions/pmLogicalPosition";
import { updateStoredPolymarketOrderFromClob, updateStoredPolymarketOrderFromMarket } from "../../../../polymarket/orders/history/orderSyncUpdate";
import { scalePolymarketVenueOrdersForDisplay } from "../../../../polymarket/orders/history/orders";
import type { VenueOrder } from "@changmen/client-core/contract";

const condition = "0x" + "a".repeat(64);
function row(price?: 0 | 0.5 | 1, sold = 0): OrderRowLike {
  const profit = sold === 100 ? 17 : sold ? -4 + (100 - sold) * (price ?? 0) - 40 * (1 - sold / 100)
    : price === undefined ? 0 : 100 * price - 40;
  return { Type: "Polymarket", OrderID: "same", CreateAt: 123, Link: 456, Odds: 2.5,
    BetMoney: 40 * 6.65, Money: profit * 6.65,
    Status: price === undefined ? "None" : price === 0 ? "Lose" : "Win", PmShares: 100,
    PmFillPrice: 0.4, PmStakeUsdc: 40 * (1 - sold / 100), PmFeeUsdc: 0.1,
    PmAttributedSellShares: sold, PmRealizedPnlUsdc: sold ? -4 : undefined, PmSellProceeds: sold ? 12 : undefined,
    PmTokenId: "101", PmConditionId: condition, PmOrigin: "changmen", PmSide: "buy",
    PmSellState: sold === 100 ? "closed" : price === undefined ? "open" : "settled",
    ...(price === undefined ? {} : { PmMatchResult: price === 0.5 ? "EqualSplit" : price === 1 ? "Win" : "Lose",
      PmSettlement: { conditionId: condition, assetId: "101", price, source: price === 0.5 ? "resolution" : "clob" } }) };
}
function savedRow(order: VenueOrder): OrderRowLike {
  return { ...row(order.pmSettlement?.price, order.pmAttributedSellShares), BetMoney: order.betMoney,
    Money: order.money, Status: order.status, PmStakeUsdc: order.pmStakeUsdc, PmSellState: order.pmSellState };
}

it.each([undefined, 0, 0.5, 1] as const)("stored → compute → display preserves currencies and identity for final price %s", price => {
  let saved = row(price);
  for (let sync = 0; sync < 3; sync++) {
    const loaded = venueOrderFromOrderRow(saved);
    const computed = updateStoredPolymarketOrderFromMarket(loaded, undefined, "");
    const expectedPayout = price === undefined ? 100 : 100 * price;
    expect(computed.reward).toBeCloseTo(expectedPayout, 4);
    expect(computed.betMoney).toBe(40);
    expect(computed.pmStakeUsdc).toBe(40);
    expect(computed.pmFeeUsdc).toBe(0.1);
    const displayed = scalePolymarketVenueOrdersForDisplay([computed])[0]!;
    expect(displayed.reward).toBeCloseTo(expectedPayout * 6.65, 4);
    expect(displayed.betMoney).toBe(40 * 6.65);
    expect(displayed.money).toBeCloseTo(saved.Money!, 4);
    expect(displayed).toMatchObject({ orderId: "same", link: 456, pmShares: 100, pmTokenId: "101", pmConditionId: condition });
    saved = savedRow(displayed);
  }
});

it.each([0, 0.5, 1] as const)("verified payout %s uses only remaining shares after a partial sale", price => {
  const loaded = venueOrderFromOrderRow(row(price, 40));
  const computed = updateStoredPolymarketOrderFromMarket(loaded, undefined, "");
  expect(computed.reward).toBeCloseTo(60 * price, 4);
  expect(computed.money).toBe(-4 + 60 * price - 24);
  expect(computed.pmRealizedPnlUsdc).toBe(-4);
  expect(computed.pmStakeUsdc).toBe(24);
});

it("a fully sold position has no remaining maturity payout and keeps sale profit", () => {
  const loaded = venueOrderFromOrderRow(row(0.5, 100));
  expect(updateStoredPolymarketOrderFromMarket(loaded, undefined, ""))
    .toMatchObject({ money: 17, reward: 0, pmSellState: "closed", pmStakeUsdc: 0 });
});

it.each([0, 0.5, 1] as const)("corrects the venue label while preserving a verified payout of %s against stale trades", price => {
  const stored = { ...venueOrderFromOrderRow(row(price)), bet: "[地图3] 获胜" };
  const clob = { ...stored, status: "none", pmSettlement: undefined, pmMatchResult: undefined } as VenueOrder;
  const unchanged = updateStoredPolymarketOrderFromClob(stored, clob, "");
  expect(updateStoredPolymarketOrderFromClob(stored, clob, "全场")).toEqual({ ...unchanged, bet: "全场" });
  expect(stored.bet).toBe("[地图3] 获胜");
  expect(updateStoredPolymarketOrderFromClob(stored, { ...clob, pmTokenId: "other-asset" }, "全场").bet).toBe(stored.bet);
});
