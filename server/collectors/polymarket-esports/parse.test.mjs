import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildPolymarketMappedMarket,
  decimalOddsFromProbability,
  mapPolymarketGameId,
  parseJsonArray,
  resolvePolymarketMapMarketOutcome,
} from "./parse.js";

describe("polymarket-esports parse", () => {
  it("parseJsonArray accepts stringified arrays", () => {
    assert.deepEqual(parseJsonArray('["a","b"]'), ["a", "b"]);
  });

  it("decimalOddsFromProbability truncates to 3 decimals", () => {
    assert.equal(decimalOddsFromProbability(0.5), 2);
    assert.equal(decimalOddsFromProbability(0.51), 1.96);
  });

  it("resolvePolymarketMapMarketOutcome prefers official winner", () => {
    const out = resolvePolymarketMapMarketOutcome({
      clob_token_ids: '["tok-h","tok-a"]',
      outcomePrices: '["0.999","0.001"]',
      tokens: [
        { token_id: "tok-h", winner: false },
        { token_id: "tok-a", winner: true },
      ],
    });
    assert.deepEqual(out, { mapOutcome: "away", outcomeKind: "official" });
  });

  it("resolvePolymarketMapMarketOutcome falls back to price ≥0.99", () => {
    const out = resolvePolymarketMapMarketOutcome({
      clobTokenIds: '["tok-h","tok-a"]',
      outcomePrices: '["0.9995","0.0005"]',
    });
    assert.deepEqual(out, { mapOutcome: "home", outcomeKind: "price" });
  });

  it("maps lol moneyline market", () => {
    const market = {
      condition_id: "0xcond",
      sportsMarketType: "moneyline",
      groupItemTitle: "Match Winner",
      active: true,
      closed: false,
      clob_token_ids: '["tok-h","tok-a"]',
      outcomes: '["T1","GEN"]',
      gameStartTime: Date.now() + 600_000,
      events: [{ id: "evt-1", title: "T1 vs GEN", slug: "lol-t1-gen" }],
      tags: [{ slug: "lol", label: "LoL" }],
    };
    assert.equal(mapPolymarketGameId(market), "lol");
    const mapped = buildPolymarketMappedMarket(market, {
      "tok-h": 0.55,
      "tok-a": 0.48,
    });
    assert.ok(mapped);
    assert.equal(mapped.match.SourceMatchID, "evt-1");
    assert.equal(mapped.bet.SourceBetID, "0xcond");
    assert.equal(mapped.bet.SourceHomeID, "tok-h");
    assert.equal(mapped.bet.Map, 0);
    assert.ok(mapped.bet.HomeOdds > 0);
    assert.equal(mapped.bet.Status, "Normal");
  });

  it("does not declare match winner from high prices while the market is open", () => {
    const market = {
      condition_id: "0xmatch",
      sportsMarketType: "moneyline",
      groupItemTitle: "Match Winner",
      active: true,
      closed: false,
      clob_token_ids: '["tok-h","tok-a"]',
      outcomes: '["T1","GEN"]',
      outcomePrices: '["0.001","0.999"]',
      gameStartTime: Date.now() + 600_000,
      events: [{ id: "evt-ml", title: "T1 vs GEN" }],
      tags: [{ slug: "lol", label: "LoL" }],
    };
    const mapped = buildPolymarketMappedMarket(market, { "tok-h": 0.001, "tok-a": 0.999 });
    assert.ok(mapped);
    assert.equal(mapped.bet.Map, 0);
    assert.equal(mapped.mapOutcome, undefined);
    assert.equal(mapped.outcomeKind, undefined);
    market.tokens = [{ token_id: "tok-a", winner: true }];
    const official = buildPolymarketMappedMarket(market, { "tok-h": 0.001, "tok-a": 0.999 });
    assert.equal(official.mapOutcome, "away");
    assert.equal(official.outcomeKind, "official");
  });

  it("attaches mapOutcome from outcomePrices on child map market", () => {
    const market = {
      condition_id: "0xmap3",
      sportsMarketType: "child_moneyline",
      groupItemTitle: "Map 3 Winner",
      active: true,
      closed: false,
      clob_token_ids: '["tok-h","tok-a"]',
      outcomes: '["Heroic","K27"]',
      outcomePrices: '["0.9995","0.0005"]',
      gameStartTime: Date.now() + 600_000,
      events: [{ id: "evt-m3", title: "Heroic vs K27" }],
      tags: [{ slug: "cs2", label: "CS2" }],
    };
    const mapped = buildPolymarketMappedMarket(market, { "tok-h": 0.9995, "tok-a": 0.0005 });
    assert.ok(mapped);
    assert.equal(mapped.bet.Map, 3);
    assert.equal(mapped.mapOutcome, "home");
    assert.equal(mapped.outcomeKind, "price");
  });

  it("attaches resolutionSource from Gamma event", () => {
    const market = {
      condition_id: "0xcond",
      sportsMarketType: "moneyline",
      groupItemTitle: "Match Winner",
      active: true,
      closed: false,
      clob_token_ids: '["tok-h","tok-a"]',
      outcomes: '["T1","GEN"]',
      gameStartTime: Date.now() + 600_000,
      events: [{
        id: "evt-1",
        title: "T1 vs GEN",
        slug: "lol-t1-gen",
        resolutionSource: "https://www.twitch.tv/valorantesports_cn",
      }],
      tags: [{ slug: "lol", label: "LoL" }],
    };
    const mapped = buildPolymarketMappedMarket(market, { "tok-h": 0.55, "tok-a": 0.48 });
    assert.ok(mapped);
    assert.equal(mapped.resolutionSource, "https://www.twitch.tv/valorantesports_cn");
    assert.equal(mapped.eventSlug, "lol-t1-gen");
  });

  it("rejects yes/no outcomes", () => {
    const market = {
      condition_id: "0xcond",
      sportsMarketType: "moneyline",
      groupItemTitle: "Match Winner",
      active: true,
      clob_token_ids: '["a","b"]',
      outcomes: '["Yes","No"]',
      events: [{ id: "e1" }],
      tags: [{ slug: "cs2" }],
    };
    assert.equal(buildPolymarketMappedMarket(market), null);
  });
});
