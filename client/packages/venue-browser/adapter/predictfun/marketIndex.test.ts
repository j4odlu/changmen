import { describe, expect, it } from "vitest";
import {
  __resetPredictFunTokenMarketIdsForTests,
  applyPredictFunMarketIndex,
  lookupPredictFunMarketIdByToken,
  rememberPredictFunTokenMarketIds,
} from "./marketIndex";

describe("predictfun token→marketId map", () => {
  it("remembers tokens from MarketIndex for checkBet without fo", () => {
    __resetPredictFunTokenMarketIdsForTests();
    rememberPredictFunTokenMarketIds({
      updatedAt: 1,
      marketIds: ["844582"],
      entries: [{
        sourceMatchId: "221930",
        categoryId: "cat",
        homeMarketId: "844582",
        awayMarketId: "844582",
        homeTokenId: "tok-home",
        awayTokenId: "tok-away",
        sourceBetId: "bet#m0",
        homeName: "Kits",
        awayName: "SDM",
        homeOdds: 2,
        awayOdds: 1.4,
        status: "Normal",
      }],
    });
    expect(lookupPredictFunMarketIdByToken("tok-away")).toBe("844582");
    expect(lookupPredictFunMarketIdByToken("tok-home")).toBe("844582");
    expect(lookupPredictFunMarketIdByToken("missing")).toBe("");
  });

  it("applyPredictFunMarketIndex also fills the map", () => {
    __resetPredictFunTokenMarketIdsForTests();
    applyPredictFunMarketIndex({
      updatedAt: 2,
      marketIds: ["9"],
      entries: [{
        sourceMatchId: "1",
        categoryId: "c",
        homeMarketId: "9",
        awayMarketId: "9",
        homeTokenId: "h",
        awayTokenId: "a",
        sourceBetId: "b",
        homeName: "H",
        awayName: "A",
        homeOdds: 2,
        awayOdds: 2,
        status: "Normal",
      }],
    }, {
      marketsByCategory: new Map(),
      marketIdToCategory: new Map(),
    });
    expect(lookupPredictFunMarketIdByToken("a")).toBe("9");
  });
});
