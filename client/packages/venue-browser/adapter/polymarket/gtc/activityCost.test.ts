import { beforeEach, expect, it, vi } from "vitest";
import { readGtcFacts } from "@changmen/venue-browser/polymarket/gtc/index";
import { mergeGtcOrderFacts, type GtcOrderFactsState } from "@changmen/shared/pm_gtc_order";
const io=vi.hoisted(()=>({activity:vi.fn(),trades:vi.fn(),order:vi.fn()}));
vi.mock("@changmen/venue-browser/polymarket/transport/transport",()=>({polymarketPluginGet:io.activity,polymarketL2Get:io.trades}));
vi.mock("@changmen/venue-browser/polymarket/orders/pmClientApi",()=>({pmGetOrder:io.order,pmCancelOrder:vi.fn(),pmSubmitOrder:vi.fn()}));
vi.mock("@changmen/venue-browser/polymarket/auth/l2Auth",()=>({parseTokenConfig:()=>({}),resolveFunder:()=>`0x${"1".repeat(40)}`,resolveApiCreds:()=>({address:`0x${"1".repeat(40)}`})}));
const wallet=`0x${"1".repeat(40)}`,tx=`0x${"a".repeat(64)}`,tx2=`0x${"b".repeat(64)}`;
const plan={tokenId:"token",conditionId:"condition",shares:"10"};
const trade={id:"t",taker_order_id:"foreign",asset_id:"token",side:"SELL",size:"3",price:"0.5",status:"CONFIRMED",match_time:"1000",last_update:"1000",transaction_hash:tx,maker_orders:[{order_id:"order",asset_id:"token",side:"BUY",matched_amount:"3",price:"0.5"}]};
const activity={proxy_wallet:wallet,type:"TRADE",side:"BUY",token_id:"token",condition_id:"condition",timestamp:1000,transaction_hash:tx,size:3,price:.5,usdc_size:1.5075};
const page=(rows:unknown[])=>({data:rows,pagination:{has_more:false,next_cursor:null}});
const initial=():GtcOrderFactsState=>({plan:{shares:"10",orderHash:"order"},submit:"accepted",orderId:"order",pmAuthorized:true,cancel:null,fills:{},order:null,matched:"0",principal:"0",fee:null,open:null,terminal:false,complete:false,observedAt:0,error:""});
beforeEach(()=>{vi.resetAllMocks();io.trades.mockResolvedValue({data:[trade],next_cursor:"LTE="});io.activity.mockResolvedValue(page([activity]));io.order.mockResolvedValue({id:"order",asset_id:"token",side:"BUY",original_size:"10",size_matched:"3",status:"CANCELED",associate_trades:["t"]});});
it("records fee-bearing maker cash directly, including builder fees",async()=>{
  const facts=await readGtcFacts({} as never,plan,"order",1);
  expect(facts.fills[0]).toMatchObject({cost:"1.5075",fee:"0.0075",price:"0.5",role:"MAKER"});
  expect(mergeGtcOrderFacts(initial(),facts)).toMatchObject({cost:"1.5075",principal:"1.5",fee:"0.0075",complete:true});
});
it("accumulates multiple official fills and keeps their six-decimal total",async()=>{
  const other={...trade,id:"t2",transaction_hash:tx2,maker_orders:[{...trade.maker_orders[0]!,matched_amount:"4",price:"0.6"}]};
  io.trades.mockResolvedValue({data:[trade,other],next_cursor:"LTE="});
  io.order.mockResolvedValue({id:"order",asset_id:"token",side:"BUY",original_size:"10",size_matched:"7",status:"CANCELED",associate_trades:["t","t2"]});
  io.activity.mockResolvedValue(page([activity,{...activity,transaction_hash:tx2,size:4,price:.6,usdc_size:2.412049}]));
  expect(mergeGtcOrderFacts(initial(),await readGtcFacts({} as never,plan,"order",1))).toMatchObject({cost:"3.919549",principal:"3.9",fee:"0.019549",matched:"7",complete:true});
});
it("keeps costs unknown when activity is absent or belongs to a different wallet",async()=>{
  for(const rows of [[],[{...activity,proxy_wallet:`0x${"2".repeat(40)}`}],[{...activity,size:6,usdc_size:3.015}]]){
    io.activity.mockResolvedValue(page(rows));const facts=await readGtcFacts({} as never,plan,"order",1);
    expect(facts.fills[0]?.fee).toBeNull();expect(facts.fills[0]?.cost).toBeUndefined();
    expect(mergeGtcOrderFacts(initial(),facts)).toMatchObject({fee:null,complete:false});
  }
});
it("does not lose verified cash when a later activity read is temporarily empty",async()=>{
  const first=mergeGtcOrderFacts(initial(),await readGtcFacts({} as never,plan,"order",1));
  io.activity.mockResolvedValue(page([]));
  expect(mergeGtcOrderFacts(first,await readGtcFacts({} as never,plan,"order",1))).toMatchObject({cost:"1.5075",principal:"1.5",fee:"0.0075",complete:true});
});
it("shares activity pagination across originals using the same account history",async()=>{
  const history=Promise.resolve({trades:[trade],complete:true});
  await Promise.all([readGtcFacts({} as never,plan,"order",1,history),readGtcFacts({} as never,plan,"order",1,history)]);
  expect(io.activity).toHaveBeenCalledOnce();
});
