import { describe, expect, it, vi } from "vitest";
import { enrichPolymarketBuyVenueOrderWithFee } from "@changmen/venue-browser/polymarket/orders/pmFee";
import { parsePolymarketActivityBuyCost } from "@changmen/venue-browser/polymarket/orders/history/pmActivity";
import type { PolymarketActivityTradeRow } from "@changmen/venue-browser/polymarket/orders/history/pmActivity";
import { polymarketPluginGet } from "@changmen/venue-browser/polymarket/transport/transport";
vi.mock("@changmen/venue-browser/polymarket/transport/transport",()=>({polymarketPluginGet:vi.fn()}));
const wallet=`0x${"1".repeat(40)}`, tx=`0x${"a".repeat(64)}`, tx2=`0x${"b".repeat(64)}`;
const order={orderId:"order",pmSide:"buy",pmConditionId:"condition",pmTokenId:"token",pmShares:25,pmFillPrice:.4,pmStakeUsdc:10,betMoney:10,odds:2.5,status:"none",pmSellState:"open"};
const row:PolymarketActivityTradeRow={proxyWallet:wallet,type:"TRADE",side:"BUY",conditionId:"condition",asset:"token",transactionHash:tx,size:25,price:.4,usdcSize:10.36};
const options=(rows=[row],hashes=[tx])=>({proxyWallet:wallet,activityRows:rows,txHashesByOrderId:new Map([["order",hashes]])});
describe("official BUY activity is the total cost",()=>{
  it("uses cash including builder fees directly, replacing an old fee estimate exactly once",async()=>{
    const input={...order,pmFeeUsdc:.7,pmStakeUsdc:10.7,betMoney:10.7};
    const first=await enrichPolymarketBuyVenueOrderWithFee(input,options());
    expect(first).toMatchObject({pmStakeUsdc:10.36,betMoney:10.36,pmFeeUsdc:.36,pmShares:25,pmFillPrice:.4});
    expect(await enrichPolymarketBuyVenueOrderWithFee(first,options())).toEqual(first);
    expect(polymarketPluginGet).not.toHaveBeenCalled();
  });
  it("keeps the screenshot order's full six-decimal cash rather than re-deriving it from rounded price",async()=>{
    const input={...order,pmShares:22.951211,pmFillPrice:.65};
    const next=await enrichPolymarketBuyVenueOrderWithFee(input,options([{...row,size:22.951211,price:.6505102933,usdcSize:15.280459}]));
    expect(next.pmStakeUsdc).toBe(15.280459);expect(next.betMoney).toBe(15.280459);expect(next.pmFeeUsdc).toBe(.35046);
  });
  it("sums every attributed execution before rounding",async()=>{
    const rows=[{...row,size:10,price:.4,usdcSize:4.144049},{...row,size:15,price:.42,usdcSize:6.514049,transactionHash:tx2}];
    const next=await enrichPolymarketBuyVenueOrderWithFee(order,options(rows,[tx,tx2]));
    expect(next.pmStakeUsdc).toBe(10.658098);expect(next.pmFeeUsdc).toBe(.358098);expect(next.pmFillPrice).toBeCloseTo(.412,12);
  });
  it("does not use an incomplete execution list or an unrelated wallet's activity",async()=>{
    expect(await enrichPolymarketBuyVenueOrderWithFee(order,options([row],[tx,tx2]))).toEqual(order);
    expect(await enrichPolymarketBuyVenueOrderWithFee(order,options([{...row,proxyWallet:`0x${"2".repeat(40)}`}]))).toEqual(order);
    expect(await enrichPolymarketBuyVenueOrderWithFee(order,{activityRows:[row]})).toEqual(order);
  });
  it("does not assign shared-transaction cash to a smaller order",async()=>{
    expect(await enrichPolymarketBuyVenueOrderWithFee(order,options([{...row,size:50,usdcSize:20.72}]))).toEqual(order);
  });
  it("does not calculate or append a fee when official activity has not arrived",async()=>{
    const input={...order,pmFeeUsdc:.3,status:"lose",pmSellState:"settled",money:-10};
    expect(await enrichPolymarketBuyVenueOrderWithFee(input,options([]))).toEqual(input);
    expect(polymarketPluginGet).not.toHaveBeenCalled();
  });
  it("explicit zero clears an old fee and lowers the recorded total",async()=>{
    const next=await enrichPolymarketBuyVenueOrderWithFee({...order,pmFeeUsdc:.3,pmStakeUsdc:10.3},options([{...row,usdcSize:10}]));
    expect(next).toMatchObject({pmStakeUsdc:10,betMoney:10,pmFeeUsdc:0});
  });
  it.each([["win",14.64,25],["lose",-10.36,0]] as const)("reconciles %s payout using official total cash",async(status,money,reward)=>{
    const next=await enrichPolymarketBuyVenueOrderWithFee({...order,status,pmSellState:"settled",money:0},options());
    expect(next).toMatchObject({pmStakeUsdc:10.36,betMoney:10.36,money,reward});
  });
  it.each(["partial","closed"])("preserves remaining cost and realized profit after %s sale",async pmSellState=>{
    const input={...order,pmSellState,pmAttributedSellShares:10,pmStakeUsdc:6.2,money:1.5};
    expect(await enrichPolymarketBuyVenueOrderWithFee(input,options())).toEqual(input);
  });
  it("does not cap fee-inclusive cost per share at one dollar",()=>{
    expect(parsePolymarketActivityBuyCost({...row,size:10,price:.999,usdcSize:10.04})).toMatchObject({usdcSize:10.04,feeUsdc:.05,allInAvgPrice:1.004});
  });
});
