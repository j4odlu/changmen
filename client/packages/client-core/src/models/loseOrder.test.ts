import { describe, expect, it } from "vitest";
import { LoseOrder } from "./loseOrder";

describe("loseOrder amount formulas (A8 tb)", () => {
  it("getBetMoney hedges stake from reference odds", () => {
    const order = new LoseOrder({
      betMoney: 100,
      betOdds: 2,
      isCreateOrder: false,
    });
    expect(order.getBetMoney(2)).toBe(100);
    expect(order.getBetMoney(2.5)).toBe(80);
  });

  it("getOdds uses makeProfit for auto orders and fixed odds for manual", () => {
    const auto = new LoseOrder({ betMoney: 100, betOdds: 2, isCreateOrder: false });
    expect(auto.getOdds(1.01)).toBeGreaterThan(2);

    const manual = new LoseOrder({ betMoney: 100, betOdds: 2.5, isCreateOrder: true });
    expect(manual.getOdds(1.03)).toBe(2.5);
  });
});
