import { expect, test } from "vitest";
import { mergeOrderLogicalSave } from "../order_store.js";
import { rowToOrder } from "./dto.js";
import { gtcOrderLedger } from "../../../../../rds/rds/orderModes/gtc/pm_gtc_ledger.js";
const raw = { provider:"Polymarket",pmOrigin:"changmen",pmSide:"buy",pmShares:100,pmStakeUsdc:40,pmSellState:"open",betMoney:268,status:"lose",money:-268,pmMatchResult:"lose" };
const condition = "0x" + "a".repeat(64);
const receipt = price => ({ conditionId: condition, assetId: "102", price, source: price === 0.5 ? "resolution" : "clob" });

test.each([[0,"lose",-268],[1,"win",397]])("verified price %s determines the payout independently of a stale financial status", (price, result, expected) => {
  const incoming = { ...raw, pmTokenId:"102",pmConditionId:condition,pmMatchResult:result,pmSettlement:receipt(price),status:"return",money:0,pmSellState:"settled" };
  const saved = mergeOrderLogicalSave({ status:"Lose",money:-268,bet_money:268 },raw,incoming,"changmen");
  expect(saved).toMatchObject({ money:expected,raw:{pmMatchResult:result,pmSettlement:receipt(price),status:expected>0?"win":"lose"} });
  const late = mergeOrderLogicalSave({status:saved.raw.status,money:saved.money,bet_money:268},saved.raw,
    {...raw,money:-268,status:"lose",pmTokenId:"102",pmConditionId:condition},"changmen");
  expect(late).toMatchObject({money:expected,raw:{pmSettlement:receipt(price),pmMatchResult:result}});
  expect(rowToOrder({provider:"Polymarket",raw:late.raw,money:late.money})).toMatchObject({PmSettlement:receipt(price)});
});
test.each([[67,"win"],[-67,"lose"],[0,"return"]])("persist split profit %j with status %s independently of match result",(money,status)=>{
  const saved=mergeOrderLogicalSave({status:"Lose",money:-268,bet_money:268},raw,
    {...raw,pmMatchResult:"equal_split",pmSellState:"settled",reward:335,money,status},"changmen");
  expect(saved.money).toBe(money);expect(saved.raw.status).toBe(status);
  expect(saved.raw).toMatchObject({pmMatchResult:"equal_split",pmSellState:"settled",reward:335});
  expect(saved.bet_money).toBe(268);
  expect(rowToOrder({provider:"Polymarket",raw:saved.raw,money:saved.money,status,bet_money:268})).toMatchObject({PmMatchResult:"EqualSplit",Money:money});
});
test("partial-sale protection must allow a genuine zero final payout result",()=>{
  const previous={...raw,pmSellState:"partial",pmAttributedSellShares:40,pmRealizedPnlUsdc:-6,pmStakeUsdc:24,money:201};
  const saved=mergeOrderLogicalSave({status:"Win",money:201,bet_money:268},previous,
    {...previous,pmMatchResult:"equal_split",pmSellState:"settled",money:0,status:"return"},"changmen");
  expect(saved.money).toBe(0);expect(saved.raw).toMatchObject({status:"return",money:0,pmMatchResult:"equal_split",pmSellState:"settled"});
});
test("a late legacy paper loss cannot undo final split financials",()=>{
  const previous={...raw,pmMatchResult:"equal_split",pmSellState:"settled",money:67,status:"win",reward:335};
  const saved=mergeOrderLogicalSave({status:"Win",money:67,bet_money:268},previous,{...raw},"changmen");
  expect(saved.money).toBe(67);expect(saved.raw).toMatchObject({status:"Win",pmMatchResult:"equal_split",pmSellState:"settled",reward:335});
});

test("a legacy snapshot cannot change final split costs or shares for the next refresh", () => {
  const previous = { ...raw, pmMatchResult: "equal_split", pmSellState: "settled", money: 67, status: "win", reward: 335,
    pmFeeUsdc: 0.1, pmRealizedPnlUsdc: 0 };
  const saved = mergeOrderLogicalSave({ status: "Win", money: 67, bet_money: 268 }, previous,
    { ...raw, betMoney: 402, pmStakeUsdc: 60, pmFeeUsdc: 0.2, pmShares: 120 }, "changmen");
  expect(saved).toMatchObject({ bet_money: 268, money: 67,
    raw: { betMoney: 268, pmStakeUsdc: 40, pmShares: 100, pmFeeUsdc: 0.1, pmRealizedPnlUsdc: 0 } });
});
test("sold-out buy keeps realized P&L while its independent market outcome refreshes",()=>{
  const previous={...raw,pmSellState:"closed",pmAttributedSellShares:100,pmStakeUsdc:0,money:113.9};
  const saved=mergeOrderLogicalSave({status:"None",money:113.9,bet_money:268},previous,
    {...previous,pmMatchResult:"equal_split",pmSellState:"settled",money:67,status:"win"},"changmen");
  expect(saved.money).toBe(113.9);expect(saved.raw.pmSellState).toBe("closed");expect(saved.raw.pmMatchResult).toBe("equal_split");
});
test.each([[40,0,0,66.5,"win"],[60,0,0,-66.5,"lose"],[50,0,0,0,"return"],[40,40,12,13.3,"win"]])(
  "GTC cost %j sold %j proceeds %j uses final half payout",(cost,attr,proceeds,money,status)=>{
    const ledger=gtcOrderLedger({status:"Lose",bet_money:cost*6.65,money:-cost*6.65,raw:{...raw,pmMatchResult:"equal_split",pmSellState:attr?"partial":"settled",
      pmGtcExecutionId:"gtc",pmGtcBuyShares:100,pmGtcBuyCost:cost,pmAttributedSellShares:attr,pmSellProceeds:proceeds}});
    expect(ledger).toMatchObject({money,status,raw:{pmMatchResult:"equal_split",pmSellState:"settled"}});
    const repeated=gtcOrderLedger({status,bet_money:cost*6.65,money,raw:ledger.raw});
    expect(repeated).toEqual(ledger);
  });
