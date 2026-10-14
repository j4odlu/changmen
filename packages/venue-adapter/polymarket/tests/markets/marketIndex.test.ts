import { describe, expect, test } from "vitest";

import {
  applyPolymarketMarketIndex,
  isPolymarketMarketIndex,
} from "../../marketIndex";
import { lookupPolymarketOrderBetLabel } from "../../orders";

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
});
