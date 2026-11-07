import { describe, expect, it } from "vitest";
import {
  adminOrderBetMoneyCny,
  adminOrderBuyStakeCny,
  adminOrderMoneyCny,
  isAdminPredictionSell,
  sumAdminOrdersMoneyCny,
} from "./adminOrderMoney";

describe("adminOrderMoneyCny", () => {
  it("passes through CNY venue money", () => {
    expect(adminOrderMoneyCny({ provider: "OB", money: 100 })).toBe(100);
  });

  it("scales PredictFun buy money USDT → CNY", () => {
    expect(adminOrderMoneyCny({ provider: "PredictFun", money: -29.41, pfSide: "buy" }))
      .toBeCloseTo(-29.41 * 6.65, 6);
  });

  it("zeros PredictFun sell money", () => {
    expect(adminOrderMoneyCny({ provider: "PredictFun", money: 3, pfSide: "sell" })).toBe(0);
  });

  it("zeros Polymarket sell money", () => {
    expect(adminOrderMoneyCny({ provider: "Polymarket", money: 12, pmSide: "sell" })).toBe(0);
  });

  it("keeps Polymarket buy money", () => {
    expect(adminOrderMoneyCny({ provider: "Polymarket", money: 12, pmSide: "buy" })).toBe(12);
  });

  it("scales PredictFun betMoney", () => {
    expect(adminOrderBetMoneyCny({ provider: "PredictFun", betMoney: 27.21 }))
      .toBeCloseTo(27.21 * 6.65, 6);
  });

  it("buy stake sum skips prediction sell proceeds mirror", () => {
    expect(isAdminPredictionSell({ provider: "Polymarket", pmSide: "sell" })).toBe(true);
    expect(isAdminPredictionSell({ provider: "PredictFun", pfSide: "sell" })).toBe(true);
    expect(adminOrderBuyStakeCny({
      provider: "Polymarket",
      pmSide: "sell",
      betMoney: 80,
    })).toBe(0);
    expect(adminOrderBuyStakeCny({
      provider: "PredictFun",
      pfSide: "sell",
      betMoney: 9.9,
    })).toBe(0);
    expect(adminOrderBuyStakeCny({
      provider: "Polymarket",
      pmSide: "buy",
      betMoney: 100,
    })).toBe(100);
  });

  it("sums mixed venues with PF FX", () => {
    const sum = sumAdminOrdersMoneyCny([
      { provider: "OB", money: 100 },
      { provider: "PredictFun", money: -10, pfSide: "buy" },
      { provider: "PredictFun", money: 0, pfSide: "sell" },
    ]);
    expect(sum).toBeCloseTo(100 - 10 * 6.65, 6);
  });
});
