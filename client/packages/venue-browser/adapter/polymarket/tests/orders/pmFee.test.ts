import { describe, expect, it, vi } from "vitest";
import {
  computePolymarketBuyAllInStakeUsdc,
  computePolymarketPlatformFeeUsdc,
  enrichPolymarketBuyVenueOrderWithFee,
  parsePolymarketMarketFeeDetails,
} from "@changmen/venue-browser/polymarket/orders/pmFee";

vi.mock("@changmen/venue-browser/polymarket/transport/transport", () => ({
  polymarketPluginGet: vi.fn(async () => ({
    fd: { r: 0.05, e: 1, to: true },
  })),
}));

describe("computePolymarketPlatformFeeUsdc", () => {
  it("matches sports fee table at 100 shares @ 0.40 (rate 0.05 → 1.20)", () => {
    // docs: 100 shares @ $0.40 → Trade Value $40, Taker Fee $1.20 (sports)
    expect(computePolymarketPlatformFeeUsdc({
      shares: 100,
      price: 0.4,
      feeRate: 0.05,
    })).toBe(1.2);
  });

  it("peaks at 0.50 for sports (100 shares → 1.25)", () => {
    expect(computePolymarketPlatformFeeUsdc({
      shares: 100,
      price: 0.5,
      feeRate: 0.05,
    })).toBe(1.25);
  });

  it("returns 0 for maker when takerOnly", () => {
    expect(computePolymarketPlatformFeeUsdc({
      shares: 100,
      price: 0.4,
      feeRate: 0.05,
      takerOnly: true,
      isTaker: false,
    })).toBe(0);
  });

  it("returns 0 when feeRate is 0", () => {
    expect(computePolymarketPlatformFeeUsdc({
      shares: 25,
      price: 0.4,
      feeRate: 0,
    })).toBe(0);
  });

  it("example 10U @ 0.4 → 25 shares sports fee 0.3", () => {
    expect(computePolymarketPlatformFeeUsdc({
      shares: 25,
      price: 0.4,
      feeRate: 0.05,
    })).toBe(0.3);
  });
});

describe("computePolymarketBuyAllInStakeUsdc", () => {
  it("returns match fillPrice and all-in avg separately", () => {
    const r = computePolymarketBuyAllInStakeUsdc({
      grossStakeUsdc: 10,
      shares: 25,
      feeRate: 0.05,
    });
    expect(r.fillPrice).toBeCloseTo(0.4, 6);
    expect(r.feeUsdc).toBe(0.3);
    expect(r.allInStakeUsdc).toBe(10.3);
    expect(r.allInAvgPrice).toBeCloseTo(10.3 / 25, 6);
  });

  it("uses explicit feeUsdc when provided", () => {
    const r = computePolymarketBuyAllInStakeUsdc({
      grossStakeUsdc: 10,
      shares: 20,
      feeUsdc: 0.5,
    });
    expect(r.feeUsdc).toBe(0.5);
    expect(r.allInStakeUsdc).toBe(10.5);
    expect(r.fillPrice).toBe(0.5);
    expect(r.allInAvgPrice).toBeCloseTo(10.5 / 20, 6);
  });
});

describe("enrichPolymarketBuyVenueOrderWithFee", () => {
  it("skips when conditionId missing", async () => {
    const enriched = await enrichPolymarketBuyVenueOrderWithFee({
      pmSide: "buy",
      pmShares: 25,
      pmFillPrice: 0.4,
      pmStakeUsdc: 10,
      betMoney: 10,
      odds: 2.5,
      pmConditionId: "",
    });
    expect(enriched.pmStakeUsdc).toBe(10);
    expect(enriched.pmFeeUsdc).toBeUndefined();
  });

  it("adds fee using fill×price as gross; keeps match price as pmFillPrice", async () => {
    const enriched = await enrichPolymarketBuyVenueOrderWithFee({
      pmSide: "buy",
      pmShares: 25,
      pmFillPrice: 0.4,
      // 故意写成已含费数字；enrich 仍以 fill×price=10 为名义
      pmStakeUsdc: 10.3,
      betMoney: 10.3,
      odds: 2.5,
      pmConditionId: "0xcond-fee-test",
    });
    expect(enriched.pmFeeUsdc).toBe(0.3);
    expect(enriched.pmStakeUsdc).toBe(10.3);
    expect(enriched.betMoney).toBe(10.3);
    expect(enriched.pmFillPrice).toBe(0.4);
    expect(enriched.reward).toBe(25);
  });

  it("keeps existing fee and match price when activity unavailable", async () => {
    const enriched = await enrichPolymarketBuyVenueOrderWithFee({
      pmSide: "buy",
      pmShares: 25,
      pmFillPrice: 0.4,
      pmStakeUsdc: 10.3,
      betMoney: 10.3,
      pmFeeUsdc: 0.3,
      pmConditionId: "0xcond-already",
    });
    expect(enriched.pmFeeUsdc).toBe(0.3);
    expect(enriched.pmStakeUsdc).toBe(10.3);
    expect(enriched.pmFillPrice).toBe(0.4);
  });

  it("does not overwrite remaining stake after partial sell", async () => {
    const enriched = await enrichPolymarketBuyVenueOrderWithFee({
      pmSide: "buy",
      pmShares: 25,
      pmFillPrice: 0.4,
      pmStakeUsdc: 5.15,
      betMoney: 70,
      pmAttributedSellShares: 12.5,
      pmSellState: "partial",
      pmConditionId: "0xcond-partial",
    });
    expect(enriched.pmStakeUsdc).toBe(5.15);
    expect(enriched.pmFeeUsdc).toBeUndefined();
  });

  it("does not double-count when stake already above match notional", async () => {
    const enriched = await enrichPolymarketBuyVenueOrderWithFee({
      pmSide: "buy",
      pmShares: 25,
      pmFillPrice: 0.4,
      pmStakeUsdc: 10.3,
      betMoney: 10.3,
      pmConditionId: "0xcond-already-allin",
    });
    expect(enriched.pmFeeUsdc).toBeCloseTo(0.3, 4);
    expect(enriched.pmStakeUsdc).toBe(10.3);
    expect(enriched.pmFillPrice).toBe(0.4);
  });

  it("settled lose: still adds fee and sets money = -买入金额", async () => {
    const enriched = await enrichPolymarketBuyVenueOrderWithFee({
      pmSide: "buy",
      pmShares: 25,
      pmFillPrice: 0.4,
      pmStakeUsdc: 10,
      betMoney: 10,
      money: -10,
      status: "lose",
      pmSellState: "settled",
      pmConditionId: "0xcond-settled-lose",
    });
    expect(enriched.pmFeeUsdc).toBe(0.3);
    expect(enriched.pmStakeUsdc).toBe(10.3);
    expect(enriched.betMoney).toBe(10.3);
    expect(enriched.money).toBe(-10.3);
    expect(enriched.reward).toBe(0);
  });

  it("settled win: money = 回款 − 买入金额", async () => {
    const enriched = await enrichPolymarketBuyVenueOrderWithFee({
      pmSide: "buy",
      pmShares: 25,
      pmFillPrice: 0.4,
      pmStakeUsdc: 10,
      betMoney: 10,
      money: 15,
      status: "win",
      pmSellState: "settled",
      pmConditionId: "0xcond-settled-win",
    });
    expect(enriched.pmStakeUsdc).toBe(10.3);
    expect(enriched.betMoney).toBe(10.3);
    expect(enriched.reward).toBe(25);
    expect(enriched.money).toBeCloseTo(14.7, 4);
  });

  it("settled lose with existing fee: realigns money to -买入金额", async () => {
    const enriched = await enrichPolymarketBuyVenueOrderWithFee({
      pmSide: "buy",
      pmShares: 25,
      pmFillPrice: 0.4,
      pmStakeUsdc: 10.3,
      betMoney: 10.3,
      pmFeeUsdc: 0.3,
      money: -10,
      status: "lose",
      pmSellState: "settled",
      pmConditionId: "0xcond-settled-fee-lose",
    });
    expect(enriched.pmFeeUsdc).toBe(0.3);
    expect(enriched.pmStakeUsdc).toBe(10.3);
    expect(enriched.betMoney).toBe(10.3);
    expect(enriched.money).toBe(-10.3);
  });

  it("settled lose: fee field present but stake still nominal → add fee into cost", async () => {
    const enriched = await enrichPolymarketBuyVenueOrderWithFee({
      pmSide: "buy",
      pmShares: 25,
      pmFillPrice: 0.4,
      pmStakeUsdc: 10,
      betMoney: 10,
      pmFeeUsdc: 0.3,
      money: -10,
      status: "lose",
      pmSellState: "settled",
      pmConditionId: "0xcond-fee-nominal-stake",
    });
    expect(enriched.pmStakeUsdc).toBe(10.3);
    expect(enriched.betMoney).toBe(10.3);
    expect(enriched.money).toBe(-10.3);
  });
});

describe("parsePolymarketMarketFeeDetails", () => {
  it("reads fd from clob-markets row", () => {
    expect(parsePolymarketMarketFeeDetails({
      fd: { r: 0.05, e: 1, to: true },
    })).toEqual({ feeRate: 0.05, exponent: 1, takerOnly: true });
  });

  it("defaults missing fd to zero rate", () => {
    expect(parsePolymarketMarketFeeDetails({})).toEqual({
      feeRate: 0,
      exponent: 1,
      takerOnly: true,
    });
  });
});
