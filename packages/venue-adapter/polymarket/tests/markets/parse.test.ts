import { describe, expect, test } from "vitest";
import {
  bestAskFromBook,
  bestBidFromBook,
  estimatePolymarketSellProceedsUsdc,
  polymarketUnrealizedProfitUsdc,
  decimalOddsFromProbability,
  mapPolymarketGameId,
  parseJsonArray,
  polymarketOrderContextFromMarket,
  type PolymarketRawMarket,
} from "../../parse";

const baseMarket: PolymarketRawMarket = {
  id: "m1",
  condition_id: "0xabc",
  active: true,
  closed: false,
  archived: false,
  accepting_orders: true,
  question: "League of Legends match winner: Team Liquid vs Fnatic",
  sports_market_type: "moneyline",
  groupItemTitle: "Match Winner",
  startDate: "2026-01-02T03:04:05.000Z",
  outcomes: JSON.stringify(["Team Liquid", "Fnatic"]),
  clob_token_ids: JSON.stringify(["asset-home", "asset-away"]),
  tags: [{ label: "esports" }, { label: "lol" }],
  events: [{ id: "event-1", title: "LoL: Team Liquid vs Fnatic" }],
};

describe("Polymarket parse (quote / order tools)", () => {
  test("does not export discovery mapper (VPS collector owns discovery)", async () => {
    const mod = await import("../../parse");
    expect("buildPolymarketMappedMarket" in mod).toBe(false);
    expect("normalizePolymarketTeamName" in mod).toBe(false);
    expect("sourceTeamId" in mod).toBe(false);
    expect("parsePeriodToRound" in mod).toBe(false);
  });

  test("parses JSON array fields", () => {
    expect(parseJsonArray("[\"a\",\"b\"]")).toEqual(["a", "b"]);
    expect(parseJsonArray(["a", 2])).toEqual(["a", "2"]);
    expect(parseJsonArray("not-json")).toEqual([]);
  });

  test("maps supported game ids from tags and title", () => {
    expect(mapPolymarketGameId(baseMarket)).toBe("lol");
    expect(mapPolymarketGameId({
      ...baseMarket,
      tags: ["Counter-Strike"],
      question: "CS2 winner",
      events: [{ id: "cs-event", seriesSlug: "counter-strike", title: "Counter-Strike: G2 vs Liquid" }],
    })).toBe("cs2");
    expect(mapPolymarketGameId({
      ...baseMarket,
      tags: [],
      question: "Map 1 Winner",
      events: [{ id: "dota-event", seriesSlug: "dota-2" }],
    })).toBe("dota2");
    expect(mapPolymarketGameId({
      ...baseMarket,
      tags: [],
      question: "Honor of Kings: TOP Esports Armor vs SYGaming",
      sportsMarketType: "moneyline",
      events: [{ seriesSlug: "honor-of-kings", eventMetadata: { league: "King Pro League" } }],
    })).toBe("kog");
  });

  test("order context labels match/map winners", () => {
    expect(polymarketOrderContextFromMarket(baseMarket)).toEqual({
      game: "lol",
      match: "League of Legends match winner: Team Liquid vs Fnatic",
      bet: "全场",
    });
    expect(polymarketOrderContextFromMarket({
      ...baseMarket,
      groupItemTitle: "Map 2 Winner",
      sports_market_type: "child_moneyline",
      question: "LoL Map 2 Winner",
    }).bet).toBe("地图2");
  });

  test("converts probability price to decimal odds", () => {
    expect(decimalOddsFromProbability("0.5")).toBe(2);
    expect(decimalOddsFromProbability(0.25)).toBe(4);
    expect(decimalOddsFromProbability(0)).toBe(0);
    expect(decimalOddsFromProbability(1)).toBe(0);
  });

  test("truncates decimal odds to 3 digits without rounding", () => {
    expect(decimalOddsFromProbability(0.37)).toBe(2.702);
    expect(decimalOddsFromProbability(0.333)).toBe(3.003);
  });

  test("uses lowest non-empty ask as buy price", () => {
    expect(bestAskFromBook({
      asks: [
        { price: "0.62", size: "0" },
        { price: "0.58", size: "10" },
        { price: "0.6", size: "3" },
      ],
    })).toBe(0.58);
  });

  test("uses highest non-empty bid as sell price", () => {
    expect(bestBidFromBook({
      bids: [
        { price: "0.55", size: "5" },
        { price: "0.61", size: "2" },
        { price: "0.59", size: "0" },
      ],
    })).toBe(0.61);
  });

  test("estimates sell proceeds and unrealized profit", () => {
    const bids = [
      { price: 0.8, size: 2 },
      { price: 0.7, size: 10 },
    ];
    expect(estimatePolymarketSellProceedsUsdc(bids, 5)).toBe(3.7);
    expect(polymarketUnrealizedProfitUsdc(bids, 5, 5)).toBe(-1.3);
  });
});
