import { describe, expect, it } from "vitest";
import { mergePolymarketSettlementForSave } from "./polymarket_order_settlement.js";

const condition = "0x" + "a".repeat(64);
const base = { pmSide: "buy", pmShares: 100, pmStakeUsdc: 40, betMoney: 268,
  pmTokenId: "102", pmConditionId: condition, pmSellState: "open", status: "none", money: 0 };
const receipt = price => ({ conditionId: condition, assetId: "102", price, source: price === 0.5 ? "resolution" : "clob" });
function settle(incoming, prevRaw = base, extra = {}) {
  return mergePolymarketSettlementForSave({ prevRow: { money: prevRaw.money, bet_money: prevRaw.betMoney, status: prevRaw.status },
    prevRaw, incoming, raw: incoming, money: incoming.money, betMoney: incoming.betMoney, ...extra });
}

describe("PM persistence settlement policy without database or venue IO", () => {
  it.each([[0, "lose", -268], [1, "win", 402]])("official payout %s overrides stale financial status", (price, result, money) => {
    const incoming = Object.freeze({ ...base, status: "return", pmMatchResult: result, pmSettlement: receipt(price), pmSellState: "settled" });
    const saved = settle(incoming, Object.freeze({ ...base }));
    expect(saved).toMatchObject({ money, raw: { status: result, money, reward: price * 670 } });
    expect(incoming.money).toBe(0);
    expect(saved.raw).not.toBe(incoming);
  });

  it("a market win with fee-inclusive cost above payout is a financial loss", () => {
    const saved = settle({ ...base, pmShares: 30, betMoney: 268, pmMatchResult: "win", pmSettlement: receipt(1) });
    expect(saved).toMatchObject({ money: -67, raw: { pmMatchResult: "win", status: "lose", reward: 201 } });
  });

  it.each([0, 0.5, 1])("late snapshots cannot erase payout %s or its calculation inputs", price => {
    const result = price === 0 ? "lose" : price === 1 ? "win" : "equal_split";
    const previous = { ...base, pmSettlement: receipt(price), pmMatchResult: result, pmSellState: "settled",
      pmFeeUsdc: 0.1, money: price * 670 - 268, reward: price * 670, status: price ? "win" : "lose" };
    const saved = settle({ ...base, pmTokenId: "other", pmShares: 999, pmStakeUsdc: 100,
      pmFeeUsdc: 0.2, betMoney: 670, pmMatchResult: "lose", status: "lose", money: -670 }, previous);
    expect(saved).toMatchObject({ money: previous.money, bet_money: 268, raw: {
      pmSettlement: receipt(price), pmMatchResult: result, pmShares: 100, pmStakeUsdc: 40,
      pmFeeUsdc: 0.1, pmTokenId: "102", pmSellState: "settled", money: previous.money,
    } });
  });

  it.each([
    { conditionId: "other" }, { assetId: "other" }, { price: "1" }, { source: "price" },
  ])("rejects a mismatched receipt rather than treating it as final: %j", patch => {
    const saved = settle({ ...base, status: "return", pmMatchResult: "win", pmSettlement: { ...receipt(1), ...patch } });
    expect(saved.money).toBe(0);
    expect(saved.raw.status).toBe("return");
  });

  it("a valid new receipt permits refreshing fee-inclusive costs", () => {
    const previous = { ...base, pmMatchResult: "win", pmSettlement: receipt(1), status: "win", money: 402 };
    const saved = settle({ ...previous, pmStakeUsdc: 40.1, pmFeeUsdc: 0.1, betMoney: 268.67 }, previous);
    expect(saved).toMatchObject({ money: 401.33, bet_money: 268.67 });
  });

  it("half payout can legitimately replace earlier partial-sale profit with zero", () => {
    const previous = { ...base, pmSellState: "partial", pmAttributedSellShares: 40, money: 201 };
    const saved = settle({ ...previous, pmMatchResult: "equal_split", pmSettlement: receipt(0.5), money: 0 }, previous);
    expect(saved).toMatchObject({ money: 0, raw: { status: "return", pmSellState: "settled" } });
  });

  it.each([0, 0.5, 1])("a fully sold position keeps realized profit when official payout is %s", price => {
    const previous = { ...base, pmSellState: "closed", pmAttributedSellShares: 100, money: 113.9 };
    const incoming = { ...previous, pmMatchResult: price === 0.5 ? "equal_split" : price ? "win" : "lose",
      pmSettlement: receipt(price), money: 113.9 };
    expect(settle(incoming, previous)).toMatchObject({ money: 113.9, raw: { pmSellState: "closed" } });
  });
});
