import { describe, expect, test } from "vitest";
import {
  aggregatePolymarketTrades,
  applyPolymarketSettlement,
  flattenPolymarketTrades,
  finalizePolymarketVenueOrders,
  isPolymarketMarketResolved,
  isPolymarketTradeConfirmed,
  isUserMakerOrderLeg,
  mapPolymarketTradeToVenueOrder,
  mapPolymarketTradesToVenueOrders,
  parsePolymarketBuyOrderFill,
  parsePolymarketSellOrderFill,
  polymarketBuyStakeUsdc,
  polymarketTradeRefsOrderId,
  parsePolymarketMicroUsdc,
  resolvePolymarketWinningAssetId,
  resolvePolymarketSettlement,
  scalePolymarketVenueOrdersForDisplay,
  type PolymarketTradeRow,
} from "@changmen/venue-browser/polymarket/orders/history/orders";
import { collectPolymarketUserAddresses } from "@changmen/venue-browser/polymarket/auth/l2Auth";
import { polymarketOrderContextFromMarket, type PolymarketRawMarket } from "@changmen/venue-browser/polymarket/markets/parse";

describe("parsePolymarketMicroUsdc", () => {
  test("parses micro collateral strings", () => {
    expect(parsePolymarketMicroUsdc("85000000")).toBe(85);
    expect(parsePolymarketMicroUsdc("10000000")).toBe(10);
  });

  test("passes through human-readable amounts", () => {
    expect(parsePolymarketMicroUsdc("85.5")).toBe(85.5);
    expect(parsePolymarketMicroUsdc(12)).toBe(12);
  });
});

describe("parsePolymarketBuyOrderFill", () => {
  test("parses BUY making=USDC taking=份数 micro (70 CNY @ 1.25)", () => {
    expect(parsePolymarketBuyOrderFill({
      makingAmount: "10000000",
      takingAmount: "12500000",
    })).toEqual({ stakeUsdc: 10, shares: 12.5 });
  });
});

describe("parsePolymarketSellOrderFill", () => {
  test("parses SELL making=份数 taking=USDC micro", () => {
    expect(parsePolymarketSellOrderFill({
      makingAmount: "12500000",
      takingAmount: "10000000",
    })).toEqual({ sharesSold: 12.5, proceedsUsdc: 10 });
  });
});

describe("isPolymarketTradeConfirmed", () => {
  test("accepts confirmed, matched, and mined statuses", () => {
    expect(isPolymarketTradeConfirmed("TRADE_STATUS_CONFIRMED")).toBe(true);
    expect(isPolymarketTradeConfirmed("MATCHED")).toBe(true);
    expect(isPolymarketTradeConfirmed("MINED")).toBe(true);
    expect(isPolymarketTradeConfirmed("RETRYING")).toBe(true);
  });

  test("rejects failed and cancelled statuses", () => {
    expect(isPolymarketTradeConfirmed("TRADE_STATUS_FAILED")).toBe(false);
    expect(isPolymarketTradeConfirmed("CANCELLED")).toBe(false);
  });
});

describe("polymarketTradeRefsOrderId", () => {
  test("matches taker_order_id and maker_orders.order_id", () => {
    const trade: PolymarketTradeRow = {
      taker_order_id: "0xTaker",
      maker_orders: [{ order_id: "0xMaker" }],
    };
    expect(polymarketTradeRefsOrderId(trade, "0xTaker")).toBe(true);
    expect(polymarketTradeRefsOrderId(trade, "0xMaker")).toBe(true);
    expect(polymarketTradeRefsOrderId(trade, "0xOther")).toBe(false);
  });
});

describe("polymarketBuyStakeUsdc", () => {
  test("parses micro token size from REST", () => {
    expect(polymarketBuyStakeUsdc("2000000", 0.5)).toBe(1);
  });

  test("parses human-readable share size from WS-like payloads", () => {
    expect(polymarketBuyStakeUsdc("10", 0.57)).toBeCloseTo(5.7, 4);
  });
});

describe("flattenPolymarketTrades", () => {
  test("uses maker_orders when trader_side is MAKER", () => {
    const rows = flattenPolymarketTrades([{
      trader_side: "MAKER",
      side: "BUY",
      status: "MINED",
      match_time: "1700000000",
      market: "0xmarket",
      taker_order_id: "0xtaker",
      maker_orders: [{
        order_id: "0xmaker-order",
        matched_amount: "2000000",
        price: "0.5",
        outcome: "Team A",
      }],
    }]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.taker_order_id).toBe("0xmaker-order");
  });

  test("drops counterparty maker_orders when user funder address is known (Ilbirs sell case)", () => {
    const userFunder = "0x3eDBB2D5649B2c07eeFe12fBFe2c733F148C11b8";
    const userAddresses = collectPolymarketUserAddresses({ funder: userFunder });
    const trade: PolymarketTradeRow = {
      trader_side: "MAKER",
      side: "BUY",
      status: "CONFIRMED",
      match_time: "1782822352",
      market: "0x222f98de2a15f629d45d61be7fc4809073b8e2b6a75820fa01651b6879087d0e",
      outcome: "Ilbirs eSports",
      asset_id: "43096664925939890021156714357110646049434267308263392569206421178711872585554",
      maker_orders: [
        {
          order_id: "0x137f92c989118f5a7a470d87e55da48292b5641ca4f726e56e6e2a482c43e65a",
          maker_address: userFunder,
          matched_amount: "23.24",
          price: "0.98",
          outcome: "Ilbirs eSports",
          side: "SELL",
          asset_id: "43096664925939890021156714357110646049434267308263392569206421178711872585554",
        },
        {
          order_id: "0x98ea21507110d22510ef8304af599767f0d31f854ee8c2fd05140e9187548d47",
          maker_address: "0xA951006f1Ce68498C1aeF9b013880459E6E08A2F",
          matched_amount: "15",
          price: "0.02",
          outcome: "Habibis",
          side: "BUY",
          asset_id: "39946498812908425907742353673510535035587445185779665944258669737953419673215",
        },
        {
          order_id: "0x51b0dfee5f74e2b6ee58d0e7c65eeb7972218deaf7492b912121e429f156bbb2",
          maker_address: "0x47dE133e5b7641d8F3aa36e0a750C6C9b1d9B677",
          matched_amount: "604.0773",
          price: "0.01",
          outcome: "Habibis",
          side: "BUY",
          asset_id: "39946498812908425907742353673510535035587445185779665944258669737953419673215",
        },
      ],
    };

    const rows = flattenPolymarketTrades([trade], userAddresses);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.taker_order_id).toBe("0x137f92c989118f5a7a470d87e55da48292b5641ca4f726e56e6e2a482c43e65a");
    expect(rows[0]?.side).toBe("SELL");
    expect(isUserMakerOrderLeg(trade.maker_orders![1]!, trade, userAddresses)).toBe(false);

    const orders = mapPolymarketTradesToVenueOrders([trade], new Map(), 0, userAddresses);
    expect(orders).toHaveLength(0);
  });
});

describe("aggregatePolymarketTrades", () => {
  test("merges bucket trades by taker_order_id and ignores sells", () => {
    const trades: PolymarketTradeRow[] = [
      {
        taker_order_id: "0xabc",
        side: "BUY",
        status: "TRADE_STATUS_CONFIRMED",
        size: "500000",
        price: "0.5",
        match_time: "1700000000",
        outcome: "Team A",
      },
      {
        taker_order_id: "0xabc",
        side: "BUY",
        status: "TRADE_STATUS_CONFIRMED",
        size: "500000",
        price: "0.5",
        match_time: "1700000001",
        outcome: "Team A",
        bucket_index: 1,
      },
      {
        taker_order_id: "0xsell",
        side: "SELL",
        status: "TRADE_STATUS_CONFIRMED",
        size: "1000000",
        price: "0.5",
        match_time: "1700000002",
      },
    ];

    const aggregated = aggregatePolymarketTrades(trades);
    expect(aggregated).toHaveLength(1);
    expect(aggregated[0]?.taker_order_id).toBe("0xabc");
    expect(aggregated[0]?.size).toBe("1000000");
    expect(aggregated[0]?.price).toBe("0.5");
    expect(aggregated[0]?.match_time).toBe("1700000001");
  });

  test("merges buckets with VWAP price when fill prices differ", () => {
    const trades: PolymarketTradeRow[] = [
      {
        taker_order_id: "0xabc",
        side: "BUY",
        status: "TRADE_STATUS_CONFIRMED",
        size: "10",
        price: "0.4",
        match_time: "1700000000",
        bucket_index: 0,
      },
      {
        taker_order_id: "0xabc",
        side: "BUY",
        status: "TRADE_STATUS_CONFIRMED",
        size: "10",
        price: "0.5",
        match_time: "1700000001",
        bucket_index: 1,
      },
    ];

    const aggregated = aggregatePolymarketTrades(trades);
    expect(aggregated).toHaveLength(1);
    expect(aggregated[0]?.size).toBe("20");
    expect(aggregated[0]?.price).toBe("0.45");
    expect(mapPolymarketTradeToVenueOrder(aggregated[0]!)).toMatchObject({
      betMoney: 9,
      odds: 2.2222,
    });
  });
});

describe("mapPolymarketTradeToVenueOrder", () => {
  test("maps MINED BUY trade to unsettled VenueOrder", () => {
    const order = mapPolymarketTradeToVenueOrder({
      taker_order_id: "0xorder-mined",
      market: "0xmarket",
      side: "BUY",
      status: "MINED",
      size: "10",
      price: "0.5",
      match_time: "1700000000",
      outcome: "Team A",
    });

    expect(order).toMatchObject({
      orderId: "0xorder-mined",
      betMoney: 5,
      status: "none",
    });
  });

  test("maps BUY trade to unsettled VenueOrder", () => {
    const market = {
      condition_id: "0xmarket",
      question: "Counter-Strike: Team A vs Team B (BO3)",
      sports_market_type: "child_moneyline",
      group_item_title: "Map 1 Winner",
      tags: [{ label: "cs2" }],
    };

    const order = mapPolymarketTradeToVenueOrder({
      taker_order_id: "0xorder1",
      market: "0xmarket",
      side: "BUY",
      status: "TRADE_STATUS_CONFIRMED",
      size: "2000000",
      price: "0.5",
      match_time: "1700000000",
      outcome: "Team A",
    }, market);

    expect(order).toMatchObject({
      provider: "Polymarket",
      orderId: "0xorder1",
      odds: 2,
      betMoney: 1,
      reward: 2,
      money: 0,
      status: "none",
      game: "cs2",
      match: "Counter-Strike: Team A vs Team B (BO3)",
      bet: "地图1",
      item: "Team A",
      createAt: 1_700_000_000_000,
    });
  });

  test("falls back when gamma market is missing", () => {
    const order = mapPolymarketTradeToVenueOrder({
      taker_order_id: "0xorder2",
      market: "0x1234567890",
      side: "BUY",
      status: "MATCHED",
      size: "1000000",
      price: "0.25",
      match_time: "1700000100",
      outcome: "Yes",
    });

    expect(order?.match).toBe("0x12345678…");
    expect(order?.bet).toBe("");
    expect(order?.odds).toBe(4);
    expect(order?.betMoney).toBe(0.25);
  });
});

describe("polymarketOrderContextFromMarket", () => {
  test("labels moneyline as 全场", () => {
    expect(polymarketOrderContextFromMarket({
      question: "Match winner",
      sports_market_type: "moneyline",
      tags: [{ label: "lol" }],
    })).toMatchObject({
      game: "lol",
      bet: "全场",
    });
  });
});

describe("mapPolymarketTradesToVenueOrders", () => {
  const ilbirsTrade: PolymarketTradeRow = {
    taker_order_id: "0xf6ce662fe4d026b86430fc49e29bc3600db21d76ef69fcb7e0230689289d8a53",
    market: "0xfaf8d69ad2f0677b6f987e7da1c94022f73073120e9ed28969fcf5153475116f",
    asset_id: "12876938733604859423663202044051912631612545733461708116502231340403727260024",
    side: "BUY",
    size: "6.756753",
    price: "0.74",
    status: "CONFIRMED",
    match_time: "1782736191",
    outcome: "Ilbirs eSports",
    trader_side: "TAKER",
  };

  const ilbirsTokenWin = "12876938733604859423663202044051912631612545733461708116502231340403727260024";
  const ilbirsTokenLose = "64898223322413645971505217367611485629461864230905813190263318936513341854768";

  const ilbirsMarket: PolymarketRawMarket = {
    condition_id: "0xfaf8d69ad2f0677b6f987e7da1c94022f73073120e9ed28969fcf5153475116f",
    question: "Ilbirs vs BALU Map 1",
    closed: true,
    outcomes: "[\"Ilbirs eSports\", \"BALU\"]",
    outcomePrices: "[\"1\", \"0\"]",
    clobTokenIds: `["${ilbirsTokenWin}", "${ilbirsTokenLose}"]`,
    tokens: [
      { token_id: ilbirsTokenWin, outcome: "Ilbirs eSports", price: 1, winner: true },
      { token_id: ilbirsTokenLose, outcome: "BALU", price: 0, winner: false },
    ],
  };

  test("maps production CLOB decimal share sizes (Ilbirs sample)", () => {
    const order = mapPolymarketTradeToVenueOrder(ilbirsTrade);

    expect(order).toMatchObject({
      orderId: "0xf6ce662fe4d026b86430fc49e29bc3600db21d76ef69fcb7e0230689289d8a53",
      betMoney: 5,
      odds: 1.3514,
      item: "Ilbirs eSports",
      createAt: 1_782_736_191_000,
      status: "none",
      pmTokenId: "12876938733604859423663202044051912631612545733461708116502231340403727260024",
      pmShares: 6.756753,
      pmFillPrice: 0.74,
      pmStakeUsdc: 5,
    });
  });

  test("settles Ilbirs BUY as win when official tokens[].winner set", () => {
    const [order] = mapPolymarketTradesToVenueOrders(
      [ilbirsTrade],
      new Map([[String(ilbirsMarket.condition_id), ilbirsMarket]]),
    );

    expect(order).toMatchObject({
      status: "win",
      betMoney: 5,
      reward: 6.7568,
      money: 1.7568,
      pmSellState: "settled",
    });
  });

  test("settles Ilbirs BUY as lose when opponent token wins", () => {
    const lostMarket: PolymarketRawMarket = {
      ...ilbirsMarket,
      outcomePrices: "[\"0\", \"1\"]",
      tokens: [
        { token_id: ilbirsTokenWin, outcome: "Ilbirs eSports", price: 0, winner: false },
        { token_id: ilbirsTokenLose, outcome: "BALU", price: 1, winner: true },
      ],
    };
    const [order] = mapPolymarketTradesToVenueOrders(
      [ilbirsTrade],
      new Map([[String(lostMarket.condition_id), lostMarket]]),
    );

    expect(order).toMatchObject({
      status: "lose",
      betMoney: 5,
      reward: 0,
      money: -5,
    });
  });

  test("keeps none when market closed but outcome not finalized", () => {
    const pendingMarket: PolymarketRawMarket = {
      ...ilbirsMarket,
      closed: true,
      outcomePrices: "[\"0.55\", \"0.45\"]",
      tokens: [
        { token_id: ilbirsTokenWin, outcome: "Ilbirs eSports", price: 0.55 },
        { token_id: ilbirsTokenLose, outcome: "BALU", price: 0.45 },
      ],
    };
    expect(isPolymarketMarketResolved(pendingMarket)).toBe(false);
    expect(resolvePolymarketWinningAssetId(pendingMarket)).toBeNull();

    const [order] = mapPolymarketTradesToVenueOrders(
      [ilbirsTrade],
      new Map([[String(pendingMarket.condition_id), pendingMarket]]),
    );
    expect(order?.status).toBe("none");
    expect(order?.money).toBe(0);
  });

  test("keeps none when market still open", () => {
    const openMarket: PolymarketRawMarket = {
      ...ilbirsMarket,
      closed: false,
      outcomePrices: "[\"0.74\", \"0.26\"]",
      tokens: undefined,
    };
    const [order] = mapPolymarketTradesToVenueOrders(
      [ilbirsTrade],
      new Map([[String(openMarket.condition_id), openMarket]]),
    );
    expect(order?.status).toBe("none");
  });

  test("does not settle when prices mid-range and no official winner", () => {
    const priceOnlyMarket: PolymarketRawMarket = {
      ...ilbirsMarket,
      closed: false,
      acceptingOrders: true,
      outcomePrices: "[\"0.55\", \"0.45\"]",
      umaResolutionStatus: "proposed",
      tokens: undefined,
    };
    expect(isPolymarketMarketResolved(priceOnlyMarket)).toBe(false);

    const [order] = mapPolymarketTradesToVenueOrders(
      [ilbirsTrade],
      new Map([[String(priceOnlyMarket.condition_id), priceOnlyMarket]]),
    );
    expect(order?.status).toBe("none");
  });

  test.each([["0.99", "0.01"], ["0.9995", "0.0005"], ["1", "0"]])("endpoint prices settle early while retaining sell access: %j", (home, away) => {
    const priceMarket: PolymarketRawMarket = {
      ...ilbirsMarket,
      closed: false,
      outcomePrices: JSON.stringify([home, away]),
      tokens: undefined,
    };
    expect(isPolymarketMarketResolved(priceMarket)).toBe(true);
    expect(resolvePolymarketSettlement(priceMarket)).toEqual({ winningAssetId: ilbirsTokenWin, kind: "price" });

    const [order] = mapPolymarketTradesToVenueOrders(
      [ilbirsTrade],
      new Map([[String(priceMarket.condition_id), priceMarket]]),
    );
    expect(order).toMatchObject({
      status: "win",
      betMoney: 5,
      money: 1.7568,
      reward: 6.7568,
      pmSellState: "open",
    });
    expect(order?.pmMatchResult).toBe("win");
  });

  test.each([
    { outcomePrices: '["0.9899", "0.0101"]' },
    { outcomePrices: '["0.99", "0.99"]' },
    { outcomePrices: '["1.01", "0"]' },
    { outcomePrices: '["0.99", "NaN"]' },
    { outcomePrices: '["0.99"]' },
    { clobTokenIds: '["same", "same"]' },
    { clobTokenIds: '[]' },
  ])("does not infer a result from invalid or subthreshold data: %j", (patch) => {
    expect(resolvePolymarketSettlement({ ...ilbirsMarket, tokens: undefined, ...patch })).toBeNull();
  });

  test("official winner overrides an opposite price result", () => {
    const market = { ...ilbirsMarket, tokens: [{ token_id: ilbirsTokenLose, winner: true }] };
    const [order] = mapPolymarketTradesToVenueOrders([ilbirsTrade], new Map([[String(market.condition_id), market]]));
    expect(order).toMatchObject({ status: "lose", pmMatchResult: "lose", money: -5, pmSellState: "settled" });
  });

  test("official tokens[].winner settles as win and hides sell (pmSellState settled)", () => {
    const tokenWin = String(ilbirsTrade.asset_id);
    const tokenLose = ilbirsTokenLose;
    const officialMarket: PolymarketRawMarket = {
      ...ilbirsMarket,
      closed: false,
      outcomePrices: "[\"0.55\", \"0.45\"]",
      tokens: [
        { token_id: tokenWin, outcome: "Ilbirs eSports", price: 0.55, winner: true },
        { token_id: tokenLose, outcome: "BALU", price: 0.45, winner: false },
      ],
    };
    expect(isPolymarketMarketResolved(officialMarket)).toBe(true);
    expect(resolvePolymarketWinningAssetId(officialMarket)).toBe(tokenWin);

    const [order] = mapPolymarketTradesToVenueOrders(
      [ilbirsTrade],
      new Map([[String(officialMarket.condition_id), officialMarket]]),
    );
    expect(order).toMatchObject({
      status: "win",
      betMoney: 5,
      reward: 6.7568,
      pmSellState: "settled",
    });
  });

  test("settles held BUY as lose via official tokens[].winner on opponent", () => {
    const tokenHeld = String(ilbirsTrade.asset_id);
    const tokenWin = ilbirsTokenLose;
    const officialMarket: PolymarketRawMarket = {
      ...ilbirsMarket,
      closed: true,
      outcomePrices: "[\"0.40\", \"0.60\"]",
      tokens: [
        { token_id: tokenHeld, outcome: "Ilbirs eSports", price: 0.4, winner: false },
        { token_id: tokenWin, outcome: "BALU", price: 0.6, winner: true },
      ],
    };
    const [order] = mapPolymarketTradesToVenueOrders(
      [ilbirsTrade],
      new Map([[String(officialMarket.condition_id), officialMarket]]),
    );
    expect(order).toMatchObject({
      status: "lose",
      reward: 0,
      money: -5,
      pmSellState: "settled",
    });
  });

  test("settles via official winner without closed flag", () => {
    const umaMarket: PolymarketRawMarket = {
      ...ilbirsMarket,
      closed: false,
      umaResolutionStatus: "settled_normal",
    };
    const [order] = mapPolymarketTradesToVenueOrders(
      [ilbirsTrade],
      new Map([[String(umaMarket.condition_id), umaMarket]]),
    );
    expect(order?.status).toBe("win");
    expect(order?.pmSellState).toBe("settled");
  });

  test("maps BUY trades only (SELL excluded — changmen 不做卖出)", () => {
    const sample: PolymarketTradeRow[] = [
      {
        taker_order_id: "0xbuy1",
        side: "BUY",
        status: "CONFIRMED",
        size: "6.756753",
        price: "0.74",
        match_time: "1782736191",
        outcome: "Ilbirs eSports",
        trader_side: "TAKER",
        asset_id: "asset-a",
      },
      {
        taker_order_id: "0xsell1",
        side: "SELL",
        status: "CONFIRMED",
        size: "6.41",
        price: "0.999",
        match_time: "1782690537",
        outcome: "MIBR Academy",
        trader_side: "TAKER",
        asset_id: "asset-a",
      },
      {
        taker_order_id: "0xbuy2",
        side: "BUY",
        status: "CONFIRMED",
        size: "14.545453",
        price: "0.55",
        match_time: "1782684713",
        outcome: "ShindeN",
        trader_side: "TAKER",
      },
    ];

    const orders = mapPolymarketTradesToVenueOrders(sample);
    expect(orders).toHaveLength(2);
    const buy1 = orders.find(o => o.orderId === "0xbuy1");
    expect(buy1?.pmSide).toBe("buy");
    expect(buy1?.betMoney).toBe(5);
    expect(orders.find(o => o.orderId === "0xsell1")).toBeUndefined();
  });

  test("SELL trades are not mapped to venue orders", () => {
    const token = "762766351957438558742694";
    const sample: PolymarketTradeRow[] = [
      {
        taker_order_id: "0xbuy70",
        side: "BUY",
        status: "CONFIRMED",
        size: "15.151514",
        price: "0.66",
        match_time: "1783104307",
        asset_id: token,
      },
      {
        taker_order_id: "0xbuy98",
        side: "BUY",
        status: "CONFIRMED",
        size: "24.13793",
        price: "0.58",
        match_time: "1783104471",
        asset_id: token,
      },
      {
        taker_order_id: "0xsell70",
        side: "SELL",
        status: "CONFIRMED",
        size: "15.15",
        price: "0.8",
        match_time: "1783107450",
        asset_id: token,
      },
      {
        taker_order_id: "0xsell98",
        side: "SELL",
        status: "CONFIRMED",
        size: "24.13",
        price: "0.85",
        match_time: "1783108467",
        asset_id: token,
      },
    ];

    const orders = mapPolymarketTradesToVenueOrders(sample);
    expect(orders.find(o => o.orderId === "0xsell70")).toBeUndefined();
    expect(orders.find(o => o.orderId === "0xsell98")).toBeUndefined();
    expect(orders.filter(o => o.pmSide === "buy")).toHaveLength(2);
  });

  test("finalize keeps stored changmen sell rows", () => {
    const token = "asset-a";
    const clob = mapPolymarketTradesToVenueOrders([]);
    const stored = [{
      provider: "Polymarket" as const,
      orderId: "0xsell98",
      odds: 1.1765,
      createAt: 1783108467000,
      betMoney: 144,
      reward: 0,
      money: 46,
      status: "none" as const,
      game: "",
      match: "BetBoom vs Neme",
      bet: "",
      item: "平仓",
      pmSide: "sell" as const,
      pmOrigin: "changmen" as const,
      pmBuyOrderId: "0xbuy98",
      pmShares: 24.13,
      pmStakeUsdc: 14,
      pmTokenId: token,
    }];
    const out = finalizePolymarketVenueOrders(clob, 47, stored);
    // changmen 手动卖单应保留（同 Link 展示）；external 卖单仍被 strip
    expect(out.find(o => o.orderId === "0xsell98")).toMatchObject({
      pmSide: "sell",
      pmOrigin: "changmen",
      pmBuyOrderId: "0xbuy98",
    });
  });

  test("finalize restores pmShares from CLOB when stored changmen buy has zero fill", () => {
    const token = "762766351957438558742694";
    const clob = mapPolymarketTradesToVenueOrders([{
      taker_order_id: "0xbuy70",
      side: "BUY",
      status: "CONFIRMED",
      size: "15.151514",
      price: "0.66",
      match_time: "1783104307",
      asset_id: token,
    }]);
    const stored = [{
      provider: "Polymarket" as const,
      orderId: "0xbuy70",
      odds: 1.5152,
      createAt: 1783104307000,
      betMoney: 10,
      reward: 15.1515,
      money: 5.1515,
      status: "win" as const,
      game: "",
      match: "BetBoom vs Neme",
      bet: "",
      item: "BetBoom Team",
      pmTokenId: token,
      pmShares: 0,
      pmStakeUsdc: 0,
      pmOrigin: "changmen" as const,
      pmSide: "buy" as const,
      pmSellState: "settled" as const,
    }];
    const out = finalizePolymarketVenueOrders(clob, 47, stored);
    const buy = out.find(o => o.orderId === "0xbuy70");
    expect(buy?.pmOrigin).toBe("changmen");
    expect(buy?.pmShares).toBeCloseTo(15.1515, 3);
  });

  test("finalize heals false Reject when CLOB shows fill shares", () => {
    const token = "tok-heal-reject";
    const clob = mapPolymarketTradesToVenueOrders([{
      taker_order_id: "0xbuy-rej",
      side: "BUY",
      status: "CONFIRMED",
      size: "20",
      price: "0.4",
      match_time: "1783104307",
      asset_id: token,
      outcome: "Home",
    }]);
    const stored = [{
      provider: "Polymarket" as const,
      orderId: "0xbuy-rej",
      odds: 2.5,
      createAt: 1783104307000,
      betMoney: 8,
      reward: 0,
      money: 0,
      status: "reject" as const,
      game: "",
      match: "A vs B",
      bet: "全场",
      item: "A",
      pmTokenId: token,
      pmShares: 0,
      pmOrigin: "changmen" as const,
      pmSide: "buy" as const,
      pmSellState: "open" as const,
      pmRejectReason: "unfilled" as const,
    }];
    const out = finalizePolymarketVenueOrders(clob, 47, stored);
    const buy = out.find(o => o.orderId === "0xbuy-rej");
    expect(buy?.status).toBe("none");
    expect(buy?.pmShares).toBeGreaterThan(0);
  });

  test("finalize skips changmen CLOB sell without RDS row (await persist)", () => {
    const clob = [{
      provider: "Polymarket" as const,
      orderId: "0xpending-sell",
      odds: 1.25,
      createAt: 1783108467000,
      betMoney: 8,
      reward: 0,
      money: 0,
      status: "none" as const,
      game: "",
      match: "",
      bet: "",
      item: "平仓",
      pmSide: "sell" as const,
      pmOrigin: "changmen" as const,
      pmShares: 10,
      pmTokenId: "tok",
    }];
    const out = finalizePolymarketVenueOrders(clob, 99, []);
    expect(out.find(o => o.orderId === "0xpending-sell")).toBeUndefined();
  });

  test("scalePolymarketVenueOrdersForDisplay scales USDC once to CNY", () => {
    const scaled = scalePolymarketVenueOrdersForDisplay([{
      provider: "Polymarket" as const,
      orderId: "s1",
      odds: 2,
      createAt: 1,
      betMoney: 12,
      reward: 0,
      money: 2,
      status: "none" as const,
      game: "",
      match: "",
      bet: "",
      item: "",
      pmSide: "sell" as const,
    }]);
    expect(scaled[0]?.betMoney).toBeCloseTo(12 * 6.7, 5);
    expect(scaled[0]?.money).toBeCloseTo(2 * 6.7, 5);
  });
});

describe("applyPolymarketSettlement", () => {
  test.each(["realized", "proceeds", "legacy"])("repeated price sync and opposite official result do not accumulate residual profit (%s)", (source) => {
    const market: PolymarketRawMarket = {
      condition_id: "partial-condition", outcomePrices: '["0.99", "0.01"]',
      clobTokenIds: '["token-a", "token-b"]',
    };
    const trade: PolymarketTradeRow = {
      taker_order_id: "partial-buy", side: "BUY", status: "CONFIRMED",
      asset_id: "token-a", market: "partial-condition", size: "20", price: "0.5",
    };
    const stored = {
      ...mapPolymarketTradeToVenueOrder(trade)!,
      betMoney: 67, money: 6.7, pmStakeUsdc: 5,
      pmAttributedSellShares: 10,
      pmRealizedPnlUsdc: source === "realized" ? 1 : undefined,
      pmSellProceeds: source === "legacy" ? undefined : 6,
      pmSellState: "partial" as const, pmOrigin: "changmen" as const,
    };
    const refresh = (previous: typeof stored, resultMarket: PolymarketRawMarket) => {
      const incoming = mapPolymarketTradesToVenueOrders([trade], new Map([["partial-condition", resultMarket]]));
      return finalizePolymarketVenueOrders(incoming, 0, [previous])[0]!;
    };
    const first = refresh(stored, market);
    expect(first.money).toBe(6);
    const second = refresh(scalePolymarketVenueOrdersForDisplay([first])[0]! as typeof stored, market);
    expect(second.money).toBe(6);
    const official = { ...market, tokens: [{ token_id: "token-b", winner: true }] };
    expect(refresh(scalePolymarketVenueOrdersForDisplay([second])[0]! as typeof stored, official))
      .toMatchObject({ money: -4, status: "lose", pmSellState: "settled" });
  });

  test("falls back to outcome name when asset_id missing", () => {
    const market: PolymarketRawMarket = {
      closed: true,
      outcomes: "[\"Team A\", \"Team B\"]",
      outcomePrices: "[\"0.999\", \"0.001\"]",
      clobTokenIds: "[\"token-a\", \"token-b\"]",
      tokens: [
        { token_id: "token-a", outcome: "Team A", price: 0.999, winner: true },
        { token_id: "token-b", outcome: "Team B", price: 0.001, winner: false },
      ],
    };
    const base = {
      provider: "Polymarket" as const,
      orderId: "0x1",
      odds: 2,
      createAt: 1,
      betMoney: 10,
      reward: 20,
      money: 0,
      status: "none" as const,
      game: "",
      match: "",
      bet: "",
      item: "Team A",
    };
    const settled = applyPolymarketSettlement(base, {
      side: "BUY",
      size: "20",
      price: "0.5",
      outcome: "Team A",
    }, market);

    expect(settled.status).toBe("win");
    expect(settled.reward).toBe(20);
    expect(settled.money).toBe(10);
    expect(settled.pmSellState).toBe("settled");
    expect(settled.pmMatchResult).toBe("win");
  });

  test.each(["official", "price"] as const)("sold-out closed buy accepts %s result without changing money/status", (kind) => {
    const market: PolymarketRawMarket = {
      closed: true,
      outcomes: "[\"Team A\", \"Team B\"]",
      outcomePrices: "[\"0.999\", \"0.001\"]",
      clobTokenIds: "[\"token-a\", \"token-b\"]",
      tokens: [
        { token_id: "token-a", outcome: "Team A", price: 0.999, winner: true },
        { token_id: "token-b", outcome: "Team B", price: 0.001, winner: false },
      ],
    };
    const base = {
      provider: "Polymarket" as const,
      orderId: "0xclosed",
      odds: 2,
      createAt: 1,
      betMoney: 10,
      reward: 0,
      money: 3.5,
      status: "none" as const,
      game: "",
      match: "",
      bet: "",
      item: "Team A",
      pmShares: 20,
      pmStakeUsdc: 0,
      pmSellState: "closed" as const,
      pmAttributedSellShares: 20,
      pmOrigin: "changmen" as const,
      pmSide: "buy" as const,
    };
    if (kind === "price") market.tokens = undefined;
    const settled = applyPolymarketSettlement(base, {
      side: "BUY",
      size: "20",
      price: "0.5",
      outcome: "Team A",
      asset_id: "token-a",
    }, market);

    expect(settled.pmMatchResult).toBe("win");
    expect(settled.status).toBe("none");
    expect(settled.money).toBe(3.5);
    expect(settled.pmSellState).toBe("closed");
  });

  test("endpoint price sets an early result and preserves sell access", () => {
    const market: PolymarketRawMarket = {
      closed: false,
      outcomes: "[\"Team A\", \"Team B\"]",
      outcomePrices: "[\"0.999\", \"0.001\"]",
      clobTokenIds: "[\"token-a\", \"token-b\"]",
    };
    const base = {
      provider: "Polymarket" as const,
      orderId: "0x1",
      odds: 2,
      createAt: 1,
      betMoney: 10,
      reward: 20,
      money: 0,
      status: "none" as const,
      game: "",
      match: "",
      bet: "",
      item: "Team A",
      pmSellState: "open" as const,
    };
    const settled = applyPolymarketSettlement(base, {
      side: "BUY",
      size: "20",
      price: "0.5",
      asset_id: "token-a",
      outcome: "Team A",
    }, market);

    expect(settled.status).toBe("win");
    expect(settled.money).toBe(10);
    expect(settled.pmMatchResult).toBe("win");
    expect(settled.pmSellState).toBe("open");
  });

  test.each(["official", "price"] as const)("partial sell then %s result uses remaining shares only", (kind) => {
    const market: PolymarketRawMarket = {
      closed: true,
      outcomes: "[\"Team A\", \"Team B\"]",
      outcomePrices: "[\"1\", \"0\"]",
      clobTokenIds: "[\"token-a\", \"token-b\"]",
      tokens: [
        { token_id: "token-a", outcome: "Team A", price: 1, winner: true },
        { token_id: "token-b", outcome: "Team B", price: 0, winner: false },
      ],
    };
    const base = {
      provider: "Polymarket" as const,
      orderId: "0xpartial",
      odds: 2,
      createAt: 1,
      betMoney: 5,
      reward: 0,
      money: 0,
      status: "none" as const,
      game: "",
      match: "",
      bet: "",
      item: "Team A",
      pmShares: 20,
      pmStakeUsdc: 5,
      pmAttributedSellShares: 10,
      pmSellState: "partial" as const,
    };
    if (kind === "price") market.tokens = undefined;
    const settled = applyPolymarketSettlement(base, {
      side: "BUY",
      size: "20",
      price: "0.5",
      asset_id: "token-a",
      outcome: "Team A",
    }, market);

    expect(settled.status).toBe("win");
    expect(settled.reward).toBe(10);
    expect(settled.money).toBe(5);
    expect(settled.pmSellState).toBe(kind === "official" ? "settled" : "partial");
  });

  test("finalize applies official win when changmen buy has full attr but pmSellState open", () => {
    const token = "75386013875837505917721651231431326866442042124939984378893288552777858059924";
    const conditionId = "0xa2888816798b8e064a8f40036b90f828d16db55a3f02aa71dc22490fc74f4af2";
    const market: PolymarketRawMarket = {
      condition_id: conditionId,
      closed: false,
      outcomes: "[\"NRG Academy\", \"Evil Geniuses Academy\"]",
      outcomePrices: "[\"0.9995\", \"0.0005\"]",
      clobTokenIds: `["${token}", "35527541898867321320561509748762864775931334607172134674404825610301564272314"]`,
      tokens: [
        { token_id: token, outcome: "NRG Academy", price: 0.9995, winner: true },
        {
          token_id: "35527541898867321320561509748762864775931334607172134674404825610301564272314",
          outcome: "Evil Geniuses Academy",
          price: 0.0005,
          winner: false,
        },
      ],
    };
    const clob = mapPolymarketTradesToVenueOrders([{
      taker_order_id: "0xbuy-nrg",
      side: "BUY",
      status: "CONFIRMED",
      size: "36",
      price: "0.5",
      match_time: "1783200397",
      asset_id: token,
      market: conditionId,
      outcome: "NRG Academy",
    }], new Map([[conditionId, market], [`token:${token}`, market]]));
    const stored = [{
      provider: "Polymarket" as const,
      orderId: "0xbuy-nrg",
      odds: 2,
      createAt: 1783200397000,
      betMoney: 18,
      reward: 36,
      money: 0,
      status: "none" as const,
      game: "",
      match: "NRG vs EG",
      bet: "全场",
      item: "NRG Academy",
      pmTokenId: token,
      pmShares: 36,
      pmStakeUsdc: 18,
      pmConditionId: conditionId,
      pmOrigin: "changmen" as const,
      pmSide: "buy" as const,
      pmSellState: "open" as const,
      pmAttributedSellShares: 36,
    }];
    const out = finalizePolymarketVenueOrders(clob, 47, stored);
    const buy = out.find(o => o.orderId === "0xbuy-nrg");
    expect(buy?.status).toBe("win");
    expect(buy?.money).toBe(18);
    expect(buy?.pmSellState).toBe("settled");
  });
});
