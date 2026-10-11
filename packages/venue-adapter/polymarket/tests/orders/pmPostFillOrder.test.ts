import { describe, expect, it, vi } from "vitest";
import { BetOption } from "@changmen/client-core/models/betOption";
import { BetResult } from "@changmen/client-core/models/betResult";
import { getExchange, Currency } from "@changmen/shared/currency";
import {
  buildPolymarketMatchedBuyVenueOrderFromBet,
  buildPolymarketMatchedBuyVenueOrderUsdc,
} from "../../pmPostFillOrder";

vi.mock("../../pmFee", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../pmFee")>();
  return {
    ...actual,
    fetchPolymarketMarketFeeDetails: vi.fn(async () => ({
      feeRate: 0.05,
      exponent: 1,
      takerOnly: true,
    })),
  };
});

describe("buildPolymarketMatchedBuyVenueOrderUsdc", () => {
  it("builds from matched POST making/taking amounts (no fee when rate omitted)", () => {
    const order = buildPolymarketMatchedBuyVenueOrderUsdc(
      "0xabc",
      {
        success: true,
        status: "matched",
        // 10 USDC → 10e6 micro; 20 shares → 20e6 micro @ 0.5
        makingAmount: "10000000",
        takingAmount: "20000000",
      },
      {
        odds: 2,
        game: "CS",
        match: "A vs B",
        bet: "Map 1",
        item: "A",
        pmTokenId: "tok",
        pmConditionId: "cond",
      },
    );
    expect(order).toMatchObject({
      provider: "Polymarket",
      orderId: "0xabc",
      odds: 2,
      betMoney: 10,
      pmShares: 20,
      pmFillPrice: 0.5,
      pmStakeUsdc: 10,
      pmSide: "buy",
      pmSellState: "open",
      pmOrigin: "changmen",
      status: "none",
      game: "CS",
      match: "A vs B",
      item: "A",
    });
    expect(order?.reward).toBe(20);
    expect(order?.pmFeeUsdc).toBeUndefined();
  });

  it("adds fee to stake/betMoney; fill price stays match VWAP", () => {
    const order = buildPolymarketMatchedBuyVenueOrderUsdc(
      "0xfee",
      {
        success: true,
        status: "matched",
        makingAmount: "10000000",
        takingAmount: "25000000",
      },
      {
        odds: 2.5,
        feeRate: 0.05,
      },
    );
    expect(order).toMatchObject({
      pmShares: 25,
      pmFillPrice: 0.4,
      pmFeeUsdc: 0.3,
      pmStakeUsdc: 10.3,
      betMoney: 10.3,
      reward: 25,
      odds: 2.5,
    });
  });

  it("falls back to stake/price when makingAmount missing", () => {
    const order = buildPolymarketMatchedBuyVenueOrderUsdc(
      "0xno-make",
      {
        success: true,
        status: "matched",
        takingAmount: "20000000",
      },
      {
        fallbackStakeUsdc: 10,
        fallbackPrice: 0.5,
        odds: 2,
      },
    );
    expect(order).toMatchObject({
      orderId: "0xno-make",
      betMoney: 10,
      pmShares: 20,
      pmFillPrice: 0.5,
    });
  });

  it("returns null without fill amounts or fallbacks", () => {
    expect(buildPolymarketMatchedBuyVenueOrderUsdc("0x1", {
      success: true,
      status: "matched",
      takingAmount: "0",
    })).toBeNull();
  });
});

describe("buildPolymarketMatchedBuyVenueOrderFromBet", () => {
  it("scales USDC to CNY display and skips delayed", async () => {
    const option = new BetOption("Polymarket", "cond", "tok", "Home", 10, "Home", 2);
    option.match = { game: "CS", title: "A vs B" } as never;
    option.bet = {
      homeName: "A",
      awayName: "B",
      name: "Map",
      getBetName: () => "Map 1",
    } as never;
    option.target = "Home";
    option.itemId = "tok";
    option.betId = "cond";

    const delayed = new BetResult("Polymarket", true, "delayed", {}, {
      success: true,
      status: "delayed",
      orderID: "0xd",
    });
    delayed.orderId = "0xd";
    delayed.pending = true;
    expect(await buildPolymarketMatchedBuyVenueOrderFromBet(option, delayed)).toBeNull();

    const matched = new BetResult("Polymarket", true, "ok", {}, {
      success: true,
      status: "matched",
      orderID: "0xm",
      makingAmount: "10000000",
      takingAmount: "25000000",
    });
    matched.orderId = "0xm";
    matched.beginTime = 1_700_000_000_000;
    const order = await buildPolymarketMatchedBuyVenueOrderFromBet(option, matched);
    const fx = getExchange(Currency.USDT);
    // 10U 名义 + 0.3 fee（mock feeRate 0.05）→ 10.3 × fx；买入价=撮合价
    expect(order?.pmFillPrice).toBe(0.4);
    expect(order?.pmFeeUsdc).toBe(0.3);
    expect(order?.pmStakeUsdc).toBe(10.3);
    expect(order?.betMoney).toBeCloseTo(10.3 * fx, 4);
    expect(order?.item).toBe("A");
    expect(order?.match).toBe("A vs B");
    expect(order?.createAt).toBe(1_700_000_000_000);
  });

  it("falls back to match title side when bet names missing", async () => {
    const option = new BetOption("Polymarket", "cond", "tok", "Away", 10, "Away", 2);
    option.match = { game: "CS", title: "Left Side vs Right Side" } as never;
    option.bet = {
      homeName: "",
      awayName: "",
      name: "Map",
      getBetName: () => "Map 1",
    } as never;
    option.target = "Away";
    option.itemId = "tok";
    option.betId = "cond";
    const matched = new BetResult("Polymarket", true, "ok", {}, {
      success: true,
      status: "matched",
      orderID: "0xm2",
      makingAmount: "10000000",
      takingAmount: "25000000",
    });
    matched.orderId = "0xm2";
    const order = await buildPolymarketMatchedBuyVenueOrderFromBet(option, matched);
    expect(order?.item).toBe("Right Side");
  });

  it("falls back through dashed VS match titles", async () => {
    const option = new BetOption("Polymarket", "cond", "tok", "Home", 10, "Home", 2);
    option.match = { game: "VAL", title: "SEN Otters - VS - HIMMERS" } as never;
    option.bet = {
      homeName: "",
      awayName: "",
      name: "Map",
      getBetName: () => "Map 1",
    } as never;
    option.target = "Home";
    option.itemId = "tok";
    option.betId = "cond";
    const matched = new BetResult("Polymarket", true, "ok", {}, {
      success: true,
      status: "matched",
      orderID: "0xm3",
      makingAmount: "10000000",
      takingAmount: "25000000",
    });
    matched.orderId = "0xm3";
    const order = await buildPolymarketMatchedBuyVenueOrderFromBet(option, matched);
    expect(order?.item).toBe("SEN Otters");
  });
});
