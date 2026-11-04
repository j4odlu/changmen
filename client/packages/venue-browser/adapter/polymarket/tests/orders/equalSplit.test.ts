import { expect, test, vi } from "vitest";
import { applyPolymarketSettlement, resolvePolymarketSettlement, mergePolymarketClobWithStoredOrders, mapPolymarketTradeToVenueOrder, fetchPolymarketVenueOrdersBundle } from "@changmen/venue-browser/polymarket/orders/history/orders";
import { polymarketPluginGet } from "@changmen/venue-browser/polymarket/transport/transport";
import { pmGetTrades } from "@changmen/venue-browser/polymarket/orders/pmClientApi";
import { enrichPolymarketBuyVenueOrderWithFee } from "@changmen/venue-browser/polymarket/orders/pmFee";
import type { VenueOrder } from "@changmen/client-core/contract";
import type { PolymarketRawMarket } from "@changmen/venue-browser/polymarket/markets/parse";

vi.mock("@changmen/venue-browser/polymarket/transport/transport", () => ({ polymarketPluginGet: vi.fn() }));
vi.mock("@changmen/venue-browser/polymarket/orders/pmClientApi", () => ({pmGetTrades:vi.fn()}));
const condition = "0x" + "a".repeat(64);
function market(version: "v1" | "v2"): PolymarketRawMarket {
  return { version, conditionId: condition, closed: true, outcomePrices: '["0.5","0.5"]',
    ...(version === "v2" ? { positionIds: ["201", "202"], clobTokenIds: '["101","102"]' } : { clobTokenIds: '["101","102"]' }),
    finalResolution: { condition_id: condition, status: "resolved", payouts: [500000, 500000] } };
}
function order(version: "v1" | "v2", cost = 40): VenueOrder {
  return { provider: "Polymarket", orderId: "original", createAt: 1, game: "", match: "", bet: "", item: "Home",
    odds: 100/cost, betMoney: cost, reward: 0, money: 0, status: "none", pmOrigin: "changmen", pmSide: "buy",
    pmShares: 100, pmStakeUsdc: cost, pmFillPrice: cost/100, pmTokenId: version === "v2" ? "201" : "101",
    pmConditionId: condition, pmSellState: "open" };
}
for (const version of ["v1", "v2"] as const) {
  test.each([[40, 10, "win"], [60, -10, "lose"], [50, 0, "return"], [50.1, -.1, "lose"]] as const)(`${version}: final split cost %j -> profit %j`, (cost, money, status) => {
    const base=order(version,cost),m=market(version),trade={ asset_id: base.pmTokenId, market: condition, size: "100", side: "BUY", price:String(cost/100) };
    expect(applyPolymarketSettlement(base,trade,m)).toMatchObject({ status,money,reward:50,pmMatchResult:"equal_split",pmSellState:"settled" });
    expect(applyPolymarketSettlement(base,trade,{...m,finalResolution:undefined})).toBe(base);
    expect(applyPolymarketSettlement(base,{...trade,market:"wrong"},m)).toBe(base);
    expect(resolvePolymarketSettlement({...m,finalResolution:{...m.finalResolution,status:"disputed"}})).toBeNull();
  });
  test(`${version}: both old sync paths replace a paper result and remain idempotent`,()=>{
    const base=order(version);const stored={...base,betMoney:268,money:-268,status:"lose" as const,pmMatchResult:"lose" as const};
    const m=market(version),map=new Map([[condition,m]]);
    const trade={taker_order_id:base.orderId,asset_id:base.pmTokenId,market:condition,size:"100",price:"0.4",side:"BUY"};
    const fresh=mapPolymarketTradeToVenueOrder(trade,m)!;
    for(const trades of [[],[fresh]]) {
      const [next]=mergePolymarketClobWithStoredOrders(trades,[stored],1,map);
      expect(next).toMatchObject({status:"win",money:10,reward:50,pmMatchResult:"equal_split",pmSellState:"settled"});
      const persisted={...next!,betMoney:268,money:67};
      const [again]=mergePolymarketClobWithStoredOrders([fresh],[persisted],1,map);
      expect(again).toMatchObject({status:"win",money:10,pmMatchResult:"equal_split"});
    }
  });
  test(`${version}: partial sales use remaining cost plus realized proceeds; sold-out money is preserved`,()=>{
    const base=order(version),m=market(version),trade={asset_id:base.pmTokenId,market:condition,size:"100"};
    const partial={...base,pmShares:100,pmAttributedSellShares:40,pmStakeUsdc:24,pmSellProceeds:12,pmRealizedPnlUsdc:-4,pmSellState:"partial" as const,money:32,status:"win" as const,pmMatchResult:"win" as const};
    const settled=applyPolymarketSettlement(partial,trade,m);
    expect(settled).toMatchObject({money:2,reward:30,status:"win",pmRealizedPnlUsdc:-4,pmSellState:"settled",pmMatchResult:"equal_split"});
    expect(applyPolymarketSettlement(settled,trade,m)).toEqual(settled);
    const closed={...partial,pmAttributedSellShares:100,pmStakeUsdc:0,pmSellState:"closed" as const,money:17,status:"none" as const};
    expect(applyPolymarketSettlement(closed,trade,m)).toMatchObject({money:17,status:"none",pmSellState:"closed",pmMatchResult:"equal_split"});
  });
}
test("fee refresh recomputes a split payout, including a formerly flat order",async()=>{
  const base={...order("v1",50),status:"return",pmMatchResult:"equal_split",pmSellState:"settled",pmFeeUsdc:.1,reward:50};
  const next=await enrichPolymarketBuyVenueOrderWithFee(base,{activityRows:[{type:"TRADE",side:"BUY",conditionId:condition,asset:"101",size:100,price:.5,usdcSize:50.1,timestamp:1}] as never});
  expect(next).toMatchObject({money:-.1,status:"lose",reward:50,pmMatchResult:"equal_split"});
});
test("official fractional fill precision is kept until the payout is rounded",()=>{
  const base={...order("v1",28.5694),pmShares:62.795455};
  expect(applyPolymarketSettlement(base,{asset_id:base.pmTokenId,market:condition,size:"62.795455"},market("v1")))
    .toMatchObject({reward:31.3977,money:2.8283,status:"win"});
});
test.each(["v1","v2"] as const)("%s current order reads and binds official final payouts through the public transport",async version=>{
  const m=market(version),asset=order(version).pmTokenId;
  vi.mocked(pmGetTrades).mockResolvedValue([{taker_order_id:"new",asset_id:asset,market:condition,size:"100",price:".4",side:"BUY",status:"CONFIRMED",match_time:String(Date.now()/1000)}]);
  vi.mocked(polymarketPluginGet).mockImplementation(async raw=>{
    const url=String(raw);
    if(url.includes("/v2/resolutions?"))return {data:[m.finalResolution]};
    if(url.includes("clob.polymarket.com"))return {version,condition_id:condition,closed:true,tokens:[{token_id:asset,outcome:"Home",price:.5,winner:false},{token_id:version==="v2"?"202":"102",outcome:"Away",price:.5,winner:false}]};
    return [{...m,finalResolution:undefined}];
  });
  const bundle=await fetchPolymarketVenueOrdersBundle({accountId:1,provider:"Polymarket",token:"{}"} as never);
  expect(bundle.orders[0]).toMatchObject({status:"win",money:10,reward:50,pmMatchResult:"equal_split",pmSellState:"settled"});
  expect(vi.mocked(polymarketPluginGet).mock.calls.some(([url])=>String(url).includes("data-api.polymarket.com/v2/resolutions?condition="+condition))).toBe(true);
});
