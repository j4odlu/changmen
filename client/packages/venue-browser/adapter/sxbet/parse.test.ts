import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  bestSxDecimalOdds,
  bestSxDecimalOddsFromBestRow,
  mapSxLeagueToGameCode,
  sxDecimalToProtocolOdds,
  sxImpliedToDecimal,
  sxRawOddsToImplied,
} from "./parse";
import type { SxOrder } from "./api";
import { applySxBetMarketIndex, isSxBetMarketIndex } from "./marketIndex";

const SAMPLE_ORDERS: SxOrder[] = [
  {
    marketHash: "0xabc",
    percentageOdds: "63375000000000000000",
    isMakerBettingOutcomeOne: true,
    orderStatus: "ACTIVE",
  },
  {
    marketHash: "0xabc",
    percentageOdds: "32375000000000000000",
    isMakerBettingOutcomeOne: false,
    orderStatus: "ACTIVE",
  },
];

describe("sxbet parse (browser tools)", () => {
  it("maps league labels to catalog codes", () => {
    assert.equal(mapSxLeagueToGameCode("LOL - MSI"), "lol");
    assert.equal(mapSxLeagueToGameCode("CS2 - Major"), "cs2");
    assert.equal(mapSxLeagueToGameCode("Unknown League"), null);
  });

  it("converts raw odds to decimal", () => {
    assert.equal(sxRawOddsToImplied("63375000000000000000"), 0.63375);
    assert.equal(sxImpliedToDecimal(0.5), 2);
  });

  it("picks best taker odds from orderbook", () => {
    assert.equal(bestSxDecimalOdds(SAMPLE_ORDERS, true), sxImpliedToDecimal(0.67625));
    assert.equal(bestSxDecimalOdds(SAMPLE_ORDERS, false), sxImpliedToDecimal(0.36625));
  });

  it("picks best taker odds from /orders/odds/best row", () => {
    const row = {
      marketHash: "0xabc",
      outcomeOne: { percentageOdds: "63375000000000000000" },
      outcomeTwo: { percentageOdds: "32375000000000000000" },
    };
    assert.equal(bestSxDecimalOddsFromBestRow(row, true), sxImpliedToDecimal(0.67625));
    assert.equal(bestSxDecimalOddsFromBestRow(row, false), sxImpliedToDecimal(0.36625));
  });

  it("converts decimal odds to protocol format", () => {
    assert.equal(sxDecimalToProtocolOdds(2), "50000000000000000000");
  });

  it("does not export discovery mapper", async () => {
    const mod = await import("./parse");
    assert.equal("buildSxMappedMarket" in mod, false);
    assert.equal("isSxEsportsMoneylineMarket" in mod, false);
  });
});

describe("sxbet marketIndex", () => {
  it("applies VPS index entries", () => {
    const index = {
      updatedAt: 1,
      marketHashes: ["0xhash"],
      entries: [{
        sourceMatchId: "L1",
        marketHash: "0xhash",
        homeOddsId: "0xhash:1",
        awayOddsId: "0xhash:2",
        sourceBetId: "0xhash",
        homeName: "A",
        awayName: "B",
        homeOdds: 1.9,
        awayOdds: 2.1,
        status: "Normal",
      }],
    };
    assert.equal(isSxBetMarketIndex(index), true);
    const marketsByHash = new Map();
    const hashes = applySxBetMarketIndex(index, { marketsByHash });
    assert.deepEqual(hashes, ["0xhash"]);
    assert.equal(marketsByHash.get("0xhash")?.bet.HomeOdds, 1.9);
  });
});
