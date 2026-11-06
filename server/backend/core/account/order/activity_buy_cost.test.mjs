import { describe, expect, it, vi } from "vitest";
vi.mock("@changmen/db",()=>({fetchOrdersForProfitAggregate:vi.fn(),fetchProfiles:vi.fn(),fetchPlayersByIdsIncludingDeleted:vi.fn(async()=>[]),fetchOrdersByLinks:vi.fn(async()=>[]),fetchOrdersByUserOrderIds:vi.fn(async()=>[]),fetchPredictionSellsByBuyOrderIds:vi.fn(async()=>[]),placeholderLinkFromCreateAt:ca=>ca,backendBindLinkFromCreateAt:vi.fn()}));
import { mergeOrderLogicalSave } from "../order_store.js";
const previous={pmOrigin:"changmen",pmSide:"buy",pmShares:25,pmFillPrice:.4,pmFeeUsdc:.3,pmStakeUsdc:10.3,betMoney:69.01,pmSellState:"open",status:"none",money:0};
const row={provider:"Polymarket",bet_money:69.01,money:0,status:"None",raw:previous};
describe("PM activity total persistence",()=>{
  it("accepts a verified free fill and clears an earlier positive fee estimate",()=>{
    const next=mergeOrderLogicalSave(row,previous,{provider:"Polymarket",pmSide:"buy",pmFeeUsdc:0,pmStakeUsdc:10,betMoney:67},"changmen");
    expect(next.bet_money).toBe(67);expect(next.raw).toMatchObject({pmStakeUsdc:10,pmFeeUsdc:0,betMoney:67});
  });
  it("accepts a lower official fee-bearing cost rather than keeping the previous estimate",()=>{
    const next=mergeOrderLogicalSave(row,previous,{provider:"Polymarket",pmSide:"buy",pmFeeUsdc:.2,pmStakeUsdc:10.2,betMoney:68.34},"changmen");
    expect(next.bet_money).toBe(68.34);expect(next.raw.pmStakeUsdc).toBe(10.2);
  });
  it("does not downgrade verified all-in cost when a late POST contains only principal",()=>{
    const next=mergeOrderLogicalSave(row,previous,{provider:"Polymarket",pmSide:"buy",pmStakeUsdc:10,betMoney:67},"changmen");
    expect(next.bet_money).toBe(69.01);expect(next.raw).toMatchObject({pmStakeUsdc:10.3,pmFeeUsdc:.3});
  });
  it("preserves original cost and remaining exposure after a partial sale",()=>{
    const sold={...previous,pmSellState:"partial",pmAttributedSellShares:10,pmStakeUsdc:6.18,money:1};
    const next=mergeOrderLogicalSave({...row,raw:sold},sold,{provider:"Polymarket",pmSide:"buy",pmFeeUsdc:0,pmStakeUsdc:10,betMoney:67},"changmen");
    expect(next.bet_money).toBe(69.01);expect(next.raw.pmStakeUsdc).toBe(6.18);expect(next.raw.money).toBe(1);
  });
});
