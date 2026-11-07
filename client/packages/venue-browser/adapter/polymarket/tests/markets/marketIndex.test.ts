import { describe, expect, test } from "vitest";

import {
  applyPolymarketMarketIndex,
  isPolymarketMarketIndex,
} from "@changmen/venue-browser/polymarket/markets/marketIndex";
import { lookupPolymarketOrderBetLabel } from "@changmen/venue-browser/polymarket/orders/history/orders";

describe("polymarket marketIndex", () => {
  test("isPolymarketMarketIndex", () => {
    expect(isPolymarketMarketIndex(null)).toBe(false);
    expect(isPolymarketMarketIndex({ updatedAt: 1, assetIds: [], entries: [] })).toBe(true);
    expect(isPolymarketMarketIndex({ updatedAt: 1, marketIds: [], entries: [] })).toBe(false);
  });

  test("applyPolymarketMarketIndex builds asset maps", () => {
    const marketsById = new Map();
    const assetToMarket = new Map();
    const ids = applyPolymarketMarketIndex({
      updatedAt: 1,
      assetIds: ["h", "a"],
      entries: [{
        sourceMatchId: "evt-1",
        marketId: "cond-1",
        homeTokenId: "h",
        awayTokenId: "a",
        sourceBetId: "cond-1",
        map: 0,
        homeName: "Home",
        awayName: "Away",
        homeOdds: 1.9,
        awayOdds: 2.1,
        status: "Normal",
        homeClobPrice: 0.52,
      }],
    }, { marketsById, assetToMarket });

    expect(ids).toEqual(["h", "a"]);
    expect(marketsById.get("cond-1")?.bet.SourceHomeID).toBe("h");
    expect(assetToMarket.get("a")).toBe("cond-1");
    expect(lookupPolymarketOrderBetLabel("cond-1", "a")).toBe("全场");
  });

  test("mapping-only initialization ignores odds but retains IDs, status and labels", () => {
    const maps = { marketsById: new Map(), assetToMarket: new Map() };
    const ids = applyPolymarketMarketIndex({ updatedAt: 2, assetIds: ["h2", "a2"], entries: [{
      sourceMatchId: "event", marketId: "condition", sourceBetId: "condition", map: 2,
      homeTokenId: "h2", awayTokenId: "a2", homeName: "Home", awayName: "Away",
      homeOdds: 3.571, awayOdds: 1.388, homeClobPrice: 0.28, awayClobPrice: 0.72, status: "Normal",
    }] }, maps, { includePrices: false });
    expect(ids).toEqual(["h2", "a2"]);
    expect(maps.assetToMarket.get("h2")).toBe("condition");
    expect(maps.marketsById.get("condition").bet).toMatchObject({
      SourceHomeID: "h2", SourceAwayID: "a2", HomeOdds: 0, AwayOdds: 0, Status: "Normal", Map: 2,
    });
    expect(lookupPolymarketOrderBetLabel("condition", "a2")).toBe("地图2");
  });
});
