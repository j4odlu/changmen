import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  bestAskFromPredictBook,
  buildPredictFunBookMeta,
  decimalOddsFromProbability,
  getPredictComplement,
  orderbookForOutcomeBuy,
  predictBuyAskFromYesBook,
} from "./parse";

describe("predictfun parse (quote tools only)", () => {
  it("does not export discovery mapper (VPS collector owns discovery)", async () => {
    const mod = await import("./parse");
    assert.equal("buildPredictMappedMarket" in mod, false);
    assert.equal("isPredictEsportsMoneylineCategory" in mod, false);
    assert.equal("mapPredictEsportTag" in mod, false);
    assert.equal("resolvePredictOutcomeBuyProb" in mod, false);
  });

  it("decimalOddsFromProbability truncates to 3dp", () => {
    assert.equal(decimalOddsFromProbability(0.5), 2);
    assert.equal(decimalOddsFromProbability(0), 0);
    assert.equal(decimalOddsFromProbability(1), 0);
  });

  it("reads best ask from tuple orderbook", () => {
    assert.equal(bestAskFromPredictBook({ asks: [[0.55, 100], [0.56, 50]] }), 0.55);
    assert.equal(bestAskFromPredictBook({ asks: [] }), 0);
  });

  it("getPredictComplement matches official decimalPrecision rounding", () => {
    assert.equal(getPredictComplement(0.18, 2), 0.82);
    assert.equal(getPredictComplement(0.16, 2), 0.84);
    assert.equal(getPredictComplement(0.33, 2), 0.67);
  });

  it("transforms Yes book to No asks via bids complement", () => {
    const yes = {
      marketId: 1,
      asks: [[0.18, 200], [0.19, 100]] as [number, number][],
      bids: [[0.16, 200], [0.15, 50]] as [number, number][],
    };
    const no = orderbookForOutcomeBuy(yes, { isYesOutcome: false, decimalPrecision: 2 });
    assert.deepEqual(no.asks, [[0.84, 200], [0.85, 50]]);
    assert.deepEqual(no.bids, [[0.82, 200], [0.81, 100]]);
    assert.equal(bestAskFromPredictBook(no), 0.84);
  });

  it("predictBuyAskFromYesBook matches executable buy asks", () => {
    const yes = {
      asks: [[0.18, 200]] as [number, number][],
      bids: [[0.16, 200]] as [number, number][],
    };
    assert.equal(predictBuyAskFromYesBook(yes, true, 2), 0.18);
    assert.equal(predictBuyAskFromYesBook(yes, false, 2), 0.84);
  });

  it("buildPredictFunBookMeta dual-outcome vs dual-market", () => {
    const dual = buildPredictFunBookMeta({
      homeTokenId: "h",
      awayTokenId: "a",
      yesTokenId: "h",
      dualOutcomeSameMarket: true,
    });
    assert.deepEqual(dual.tokens, [
      { tokenId: "h", isYes: true },
      { tokenId: "a", isYes: false },
    ]);
    const missingYes = buildPredictFunBookMeta({
      homeTokenId: "h",
      awayTokenId: "a",
      dualOutcomeSameMarket: true,
    });
    assert.deepEqual(missingYes.tokens, []);
    const oneSide = buildPredictFunBookMeta({
      homeTokenId: "h",
      awayTokenId: "a",
      dualOutcomeSameMarket: false,
      sideTokenId: "a",
    });
    assert.deepEqual(oneSide.tokens, [{ tokenId: "a", isYes: true }]);
  });
});
