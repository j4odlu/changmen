import { expect, test } from "vitest";
import { mergePolymarketClobWithStoredOrders, scalePolymarketVenueOrdersForDisplay } from "@changmen/venue-browser/polymarket/orders/history/orders";
import { venueOrderFromOrderRow } from "@changmen/venue-browser/polymarket/orders/positions/pmLogicalPosition";
import { polymarketVerifiedOrderPayout } from "@changmen/shared/pm_settlement";
import type { VenueOrder } from "@changmen/client-core/contract";
import type { PolymarketRawMarket } from "@changmen/venue-browser/polymarket/markets/parse";

const condition = "0x" + "a".repeat(64);
const market: PolymarketRawMarket = { version: "v1", conditionId: condition, closed: true,
  clobTokenIds: '["101","102"]', outcomePrices: '["0.5","0.5"]',
  finalResolution: { condition_id: condition, status: "resolved", payouts: [500000,500000] } };
const base: VenueOrder = { provider: "Polymarket", orderId: "buy", createAt: 1, game: "", match: "", bet: "", item: "Away",
  odds: 2, betMoney: 40 * 6.65, money: 335, reward: 0, status: "lose", pmOrigin: "changmen", pmSide: "buy",
  pmShares: 100, pmStakeUsdc: 40, pmTokenId: "102", pmConditionId: condition, pmSellState: "settled", pmMatchResult: "win" };

test.each([
  ["GTC screenshot",18.66,10.6795,71.55265,53.4693,-1.4298],
  ["FOK screenshot",15.597015,10.6851,71.59017,-71.59017,-2.9669],
] as const)("%s: settled legacy row is rechecked without any recent trade",(_label,shares,cost,bet,money,expected)=>{
  const stored={...base,pmShares:shares,pmStakeUsdc:cost,betMoney:bet,money};
  const [next]=mergePolymarketClobWithStoredOrders([], [stored],1,new Map([[condition,market]]));
  expect(next).toMatchObject({ money:expected,status:"lose",pmMatchResult:"equal_split",pmSellState:"settled",
    pmSettlement:{conditionId:condition,assetId:"102",price:0.5,source:"resolution"} });
  const [saved]=scalePolymarketVenueOrdersForDisplay([next!]);
  expect(saved!.money).toBeCloseTo(expected*6.65,5);
  const again=mergePolymarketClobWithStoredOrders([], [saved!],1,new Map())[0]!;
  expect(again.money).toBe(expected);
  expect(polymarketVerifiedOrderPayout(again)).toBe(0.5);
});

test.each([0,1] as const)("official payout %s replaces a legacy settled result",price=>{
  const m={...market,finalResolution:undefined,tokens:[{token_id:"101",winner:price===0},{token_id:"102",winner:price===1}]};
  const [next]=mergePolymarketClobWithStoredOrders([], [base],1,new Map([[condition,m]]));
  expect(next).toMatchObject({money:price*100-40,status:price===1?"win":"lose",pmSettlement:{price,source:"clob"}});
});

test("a filled flat financial result is still eligible; it is not a market refund",()=>{
  const [next]=mergePolymarketClobWithStoredOrders([], [{...base,status:"return"}],1,new Map([[condition,market]]));
  expect(next).toMatchObject({status:"win",money:10,pmMatchResult:"equal_split"});
});

test("price thresholds do not certify or overwrite an already settled legacy order",()=>{
  const [next]=mergePolymarketClobWithStoredOrders([], [base],1,new Map([[condition,{...market,finalResolution:undefined,outcomePrices:'["0","1"]'}]]));
  expect(next.pmSettlement).toBeUndefined();
  expect(next.pmMatchResult).toBe("win");
});

test("the final payout receipt survives the public order DTO round trip",()=>{
  const row=venueOrderFromOrderRow({Type:"Polymarket",OrderID:"buy",PmTokenId:"102",PmConditionId:condition,
    PmMatchResult:"EqualSplit",PmSellState:"settled",PmSettlement:{conditionId:condition,assetId:"102",price:0.5,source:"resolution"}});
  expect(polymarketVerifiedOrderPayout(row)).toBe(0.5);
  expect(polymarketVerifiedOrderPayout({...row,pmTokenId:"other"})).toBeUndefined();
});

test("an unverified recent-trade snapshot cannot replace a verified final result",()=>{
  const stored={...base,status:"win" as const,money:60 * 6.65,pmSettlement:{conditionId:condition,assetId:"102",price:1 as const,source:"clob" as const}};
  const stale={...base,status:"lose" as const,money:-40,pmMatchResult:"lose" as const,betMoney:40};
  const [next]=mergePolymarketClobWithStoredOrders([stale],[stored],1);
  expect(next).toMatchObject({money:60,status:"win",pmMatchResult:"win",pmSettlement:stored.pmSettlement});
});
