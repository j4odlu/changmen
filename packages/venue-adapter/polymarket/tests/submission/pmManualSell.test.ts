import { describe, expect, it } from "vitest";
import { Currency, getExchange } from "@changmen/shared/currency";
import { calculateSellMarketLimitPrice, buildSellAndBuyPatchOrders } from "../../pmManualSell";
import { stripPolymarketSellOrders } from "../../pmLogicalPosition";

describe("calculateSellMarketLimitPrice", () => {
  const bids = [
    { price: 0.55, size: 5 },
    { price: 0.54, size: 10 },
    { price: 0.5, size: 20 },
  ];

  it("returns worst bid price needed to fill shares", () => {
    expect(calculateSellMarketLimitPrice(bids, 4, 1)).toBe(0.55);
    expect(calculateSellMarketLimitPrice(bids, 8, 1)).toBe(0.54);
    expect(calculateSellMarketLimitPrice(bids, 20, 1)).toBe(0.5);
  });

  it("throws when depth insufficient", () => {
    expect(() => calculateSellMarketLimitPrice(bids, 40, 1)).toThrow(/深度不足/);
  });

  it("throws below min_order_size", () => {
    expect(() => calculateSellMarketLimitPrice(bids, 0.5, 1)).toThrow(/min_order_size/);
  });
});

describe("buildSellAndBuyPatchOrders dust close", () => {
  it("marks closed when sold shares leave dust below 0.0001", () => {
    const [buy, sell] = buildSellAndBuyPatchOrders({
      buy: {
        provider: "Polymarket",
        orderId: "0xbuy",
        odds: 2.941,
        createAt: 1,
        betMoney: 112,
        reward: 0,
        money: 0,
        status: "none",
        match: "Heroic vs K27",
        bet: "map3",
        item: "Heroic",
        pmShares: 48.2353,
        pmFillPrice: 0.34,
        pmStakeUsdc: 16.4,
        pmOrigin: "changmen",
        pmSide: "buy",
        pmSellState: "open",
      },
      sellOrderId: "0xsell",
      sharesSold: 48.23,
      proceedsUsdc: 16.8805,
      fillPrice: 0.35,
      createAt: 2,
    });
    expect(buy.pmSellState).toBe("closed");
    expect(buy.pmAttributedSellShares).toBe(48.2353);
    expect(buy.pmStakeUsdc).toBe(0);
    expect(buy.betMoney).toBe(112);
    expect(buy.money).toBeGreaterThan(0);
    expect(buy.pmSellProceeds).toBe(16.8805);
    expect(buy.pmLastSellOrderId).toBe("0xsell");
    expect(buy.positionEvents?.sells).toHaveLength(1);
    expect(buy.positionEvents?.sells?.[0]).toMatchObject({
      id: "0xsell",
      origin: "changmen",
      proceeds: 16.8805,
    });
    expect(sell.money).toBe(0);
    expect(sell.betMoney).toBeGreaterThan(0);
    expect(sell.pmBuyOrderId).toBe("0xbuy");
  });

  it("accumulates pmSellProceeds across partial sells", () => {
    const baseBuy = {
      provider: "Polymarket" as const,
      orderId: "0xbuy-p",
      odds: 2,
      createAt: 1,
      betMoney: 100,
      reward: 0,
      money: 0,
      status: "none" as const,
      match: "A vs B",
      bet: "map1",
      item: "A",
      pmShares: 20,
      pmFillPrice: 0.5,
      pmStakeUsdc: 10,
      pmOrigin: "changmen" as const,
      pmSide: "buy" as const,
      pmSellState: "open" as const,
    };
    const [buy1] = buildSellAndBuyPatchOrders({
      buy: baseBuy,
      sellOrderId: "0xs1",
      sharesSold: 8,
      proceedsUsdc: 4.4,
      fillPrice: 0.55,
      createAt: 2,
    });
    expect(buy1.pmSellState).toBe("partial");
    expect(buy1.pmSellProceeds).toBe(4.4);
    const [buy2] = buildSellAndBuyPatchOrders({
      buy: buy1,
      sellOrderId: "0xs2",
      sharesSold: 12,
      proceedsUsdc: 6.6,
      fillPrice: 0.55,
      createAt: 3,
    });
    expect(buy2.pmSellState).toBe("closed");
    expect(buy2.pmSellProceeds).toBe(11);
    expect(buy2.pmLastSellOrderId).toBe("0xs2");
  });

  it("ignores 0.99 price-win paper money so sell PnL is not doubled", () => {
    // 58.5833×0.6 cost ≈35.15；卖出 58.58×0.999 ≈58.52；PnL≈23.38 USDC → CNY
    const [buy] = buildSellAndBuyPatchOrders({
      buy: {
        provider: "Polymarket",
        orderId: "0xbuy-saw",
        odds: 1.666,
        createAt: 1,
        betMoney: 239,
        reward: 0,
        // 启发式已写入纸面赢利（与真实卖出盈亏同量级）
        money: 159,
        status: "win",
        match: "SAW Youngsters vs Misa Espo",
        bet: "地图2",
        item: "SAW Youngsters",
        pmShares: 58.5833,
        pmFillPrice: 0.6,
        pmStakeUsdc: 35.15,
        pmOrigin: "changmen",
        pmSide: "buy",
        pmSellState: "open",
      },
      sellOrderId: "0xsell-saw",
      sharesSold: 58.58,
      proceedsUsdc: 58.5214,
      fillPrice: 0.999,
      createAt: 2,
    });
    expect(buy.pmSellState).toBe("closed");
    expect(buy.status).toBe("none");
    // 应为单份卖出盈亏，而非 159+159=318
    const expectedSellPnl = Math.round((58.5214 - 35.15) * getExchange(Currency.USDT));
    expect(buy.money).toBe(expectedSellPnl);
    expect(buy.money).not.toBe(expectedSellPnl * 2);
  });
});

describe("stripPolymarketSellOrders keeps changmen sells", () => {
  it("keeps changmen sell and strips external sell", () => {
    const rows = stripPolymarketSellOrders([
      { orderId: "b", pmSide: "buy" as const, pmOrigin: "changmen" as const },
      { orderId: "s1", pmSide: "sell" as const, pmOrigin: "changmen" as const },
      { orderId: "s2", pmSide: "sell" as const, pmOrigin: "external" as const },
    ] as any);
    expect(rows.map((r: any) => r.orderId)).toEqual(["b", "s1"]);
  });
});
