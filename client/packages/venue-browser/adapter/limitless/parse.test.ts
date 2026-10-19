import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  bestAskFromBook,
  buildLimitlessMappedMarket,
  decimalOddsFromProbability,
  isLimitlessEsportsMatchWinnerGroup,
  mapLimitlessEsportTitle,
} from "./parse";

const SAMPLE_GROUP = {
  id: 10012427,
  slug: "team-falcons-vs-betboom-team-1783155601238",
  title: "Team Falcons vs BetBoom Team",
  marketType: "group",
  status: "FUNDED",
  expired: false,
  tradeType: "clob",
  metadata: {
    homeTeam: "Team Falcons",
    awayTeam: "BetBoom Team",
    esportTitle: "dota-2",
    marketType: "match_winner",
    startMatchTimestampInUTC: 1783414800,
  },
  markets: [
    {
      slug: "team-falcons-1783155601247",
      title: "Team Falcons",
      status: "FUNDED",
      expired: false,
      tokens: { yes: "home-yes-token" },
      prices: [0.535, 0.465],
      tradePrices: { buy: { market: [0.34, 0.86] } },
    },
    {
      slug: "betboom-team-1783155601256",
      title: "BetBoom Team",
      status: "FUNDED",
      expired: false,
      tokens: { yes: "away-yes-token" },
      prices: [0.205, 0.795],
      tradePrices: { buy: { market: [0.34, 0.93] } },
    },
    {
      slug: "team-falcons-vs-betboom-team-draw",
      title: "Draw",
      status: "FUNDED",
      expired: false,
      tokens: { yes: "draw-yes-token" },
    },
  ],
};

describe("limitless parse", () => {
  it("maps esport titles to catalog codes", () => {
    assert.equal(mapLimitlessEsportTitle("dota-2"), "dota2");
    assert.equal(mapLimitlessEsportTitle("league-of-legends"), "lol");
    assert.equal(mapLimitlessEsportTitle("cs-go"), "cs2");
    assert.equal(mapLimitlessEsportTitle("csgo"), "cs2");
    assert.equal(mapLimitlessEsportTitle("cs2"), "cs2");
    assert.equal(mapLimitlessEsportTitle("unknown"), null);
  });

  it("accepts cs-go match_winner groups from live API shape", () => {
    const group = {
      ...SAMPLE_GROUP,
      title: "Team Nemesis vs Astralis",
      metadata: {
        homeTeam: "Team Nemesis",
        awayTeam: "Astralis",
        esportTitle: "cs-go",
        marketType: "match_winner",
        startMatchTimestampInUTC: 1783414800,
      },
      markets: [
        {
          slug: "team-nemesis-yes",
          title: "Team Nemesis",
          status: "FUNDED",
          expired: false,
          tokens: { yes: "nem-yes" },
          prices: [0.4, 0.6],
        },
        {
          slug: "astralis-yes",
          title: "Astralis",
          status: "FUNDED",
          expired: false,
          tokens: { yes: "ast-yes" },
          prices: [0.6, 0.4],
        },
      ],
    };
    assert.equal(isLimitlessEsportsMatchWinnerGroup(group), true);
    const mapped = buildLimitlessMappedMarket(group);
    assert.ok(mapped);
    assert.equal(mapped!.match.SourceGameID, "cs2");
    assert.equal(mapped!.bet.Map, 0);
    assert.equal(mapped!.bet.SourceHomeID, "nem-yes");
  });

  it("detects esports match_winner groups", () => {
    assert.equal(isLimitlessEsportsMatchWinnerGroup(SAMPLE_GROUP), true);
    assert.equal(isLimitlessEsportsMatchWinnerGroup({ ...SAMPLE_GROUP, metadata: { marketType: "spreads" } }), false);
  });

  it("builds mapped market with orderbook buy prices", () => {
    const mapped = buildLimitlessMappedMarket(SAMPLE_GROUP, {
      "team-falcons-1783155601247": 0.825,
      "betboom-team-1783155601256": 0.34,
    });
    assert.ok(mapped);
    assert.equal(mapped!.match.SourceGameID, "dota2");
    assert.equal(mapped!.bet.SourceHomeID, "home-yes-token");
    assert.equal(mapped!.bet.SourceAwayID, "away-yes-token");
    assert.equal(mapped!.bet.HomeOdds, decimalOddsFromProbability(0.825));
    assert.equal(mapped!.bet.AwayOdds, decimalOddsFromProbability(0.34));
    assert.equal(mapped!.bet.Status, "Normal");
  });

  it("bestAskFromBook picks lowest ask", () => {
    assert.equal(bestAskFromBook({ asks: [{ price: 0.9, size: 1 }, { price: 0.825, size: 2 }] }), 0.825);
  });
});
