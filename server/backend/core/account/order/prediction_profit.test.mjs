import { describe, expect, it } from "vitest";
import { Currency, getExchange } from "@changmen/shared/currency";
import { polymarketEqualSplitAmounts } from "@changmen/shared/pm_settlement";
import { computePfSettlement } from "../../integrations/predictfun/pf_settle.js";
import { betMoneyForProfitAggregate, moneyForProfitAggregate } from "./profit_cny.js";

const rate = getExchange(Currency.USDT);
describe("prediction payout to report currency contract", () => {
  it.each([[40, 10], [60, -10], [50, 0], [50.1, -0.1]])(
    "PM half payout with all-in cost %s is converted once before aggregation", (cost, profit) => {
      const settled = polymarketEqualSplitAmounts(100, cost);
      expect(settled.money).toBe(profit);
      // PM persistence stores CNY; the aggregate must not convert it again.
      const row = { provider: "Polymarket", money: settled.money * rate, bet_money: cost * rate,
        status: settled.status, raw: { pmSide: "buy", pmMatchResult: "equal_split" } };
      expect(moneyForProfitAggregate(row)).toBeCloseTo(profit * rate, 8);
      expect(betMoneyForProfitAggregate(row)).toBeCloseTo(cost * rate, 8);
    });

  it("PM partial sale profit and remaining half payout enter the report once", () => {
    const result = polymarketEqualSplitAmounts(60, 24, -4);
    expect(result.money).toBe(2);
    const buy = { provider: "Polymarket", money: result.money * rate, raw: { pmSide: "buy" } };
    const sell = { provider: "Polymarket", money: -4 * rate, raw: { pmSide: "sell" } };
    expect(moneyForProfitAggregate(buy) + moneyForProfitAggregate(sell)).toBeCloseTo(2 * rate, 8);
  });

  it.each(["win", "lose"])("PF %s payout stays USDT until report aggregation", outcome => {
    const result = computePfSettlement(20, { shares: 30 }, outcome);
    const row = { provider: "PredictFun", money: result.money, bet_money: 20, status: result.status,
      raw: { pfSide: "buy" } };
    expect(moneyForProfitAggregate(row)).toBeCloseTo((outcome === "win" ? 10 : -20) * rate, 8);
    expect(betMoneyForProfitAggregate(row)).toBeCloseTo(20 * rate, 8);
    expect(moneyForProfitAggregate({ ...row, raw: { pfSide: "sell" } })).toBe(0);
  });

  it("aggregates PF financial loss even if the market outcome was a win", () => {
    const result = computePfSettlement(20, { shares: 10 }, "win");
    expect(result.status).toBe("win");
    expect(moneyForProfitAggregate({ provider: "PredictFun", money: result.money, status: result.status }))
      .toBeCloseTo(-10 * rate, 8);
  });

  it("PM submission Pending contributes neither stake nor profit; filled None keeps realized profit", () => {
    const row = { provider: "Polymarket", money: 12, bet_money: 100, raw: { pmSide: "buy" } };
    expect(moneyForProfitAggregate({ ...row, status: "Pending" })).toBe(0);
    expect(betMoneyForProfitAggregate({ ...row, status: "Pending" })).toBe(0);
    expect(moneyForProfitAggregate({ ...row, status: "None" })).toBe(12);
    expect(betMoneyForProfitAggregate({ ...row, status: "None" })).toBe(100);
  });
});
