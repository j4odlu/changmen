import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  buildAzuroMappedMarket,
  isAzuroMatchWinnerCondition,
  mapAzuroSportSlug,
  parseAzuroDecimalOdds,
} from "./parse";

const SAMPLE_GAME = {
  gameId: "1006000000000029684597",
  title: "T1 – Dplus KIA",
  startsAt: "1778400000",
  state: "Prematch",
  sport: { sportId: "1002", slug: "lol", name: "League of Legends" },
  league: { name: "LCK" },
  participants: [
    { name: "T1", sortOrder: 0 },
    { name: "Dplus KIA", sortOrder: 1 },
  ],
};

const SAMPLE_CONDITION = {
  id: "300610060000000000296845970000000000002528644147",
  conditionId: "300610060000000000296845970000000000002528644147",
  state: "Active",
  title: "Match Winner",
  hidden: false,
  marketId: 19,
  game: { gameId: "1006000000000029684597", sport: { sportId: "1002" } },
  outcomes: [
    { title: "T1", outcomeId: "6995", odds: "1.94", state: "Active", hidden: false },
    { title: "Dplus KIA", outcomeId: "6996", odds: "1.72", state: "Active", hidden: false },
  ],
};

describe("azuro parse", () => {
  it("maps esport slugs to catalog codes", () => {
    assert.equal(mapAzuroSportSlug("cs2"), "cs2");
    assert.equal(mapAzuroSportSlug("lol"), "lol");
    assert.equal(mapAzuroSportSlug("dota-2"), "dota2");
    assert.equal(mapAzuroSportSlug("football"), null);
  });

  it("detects active Match Winner conditions", () => {
    assert.equal(isAzuroMatchWinnerCondition(SAMPLE_CONDITION), true);
    assert.equal(isAzuroMatchWinnerCondition({ ...SAMPLE_CONDITION, title: "Map 1 - Winner" }), false);
    assert.equal(isAzuroMatchWinnerCondition({ ...SAMPLE_CONDITION, state: "Stopped" }), false);
  });

  it("builds mapped market from game + Match Winner", () => {
    const mapped = buildAzuroMappedMarket(SAMPLE_GAME, SAMPLE_CONDITION);
    assert.ok(mapped);
    assert.equal(mapped!.match.SourceGameID, "lol");
    assert.equal(mapped!.bet.SourceBetID, SAMPLE_CONDITION.conditionId);
    assert.equal(mapped!.bet.SourceHomeID, "6995");
    assert.equal(mapped!.bet.SourceAwayID, "6996");
    assert.equal(mapped!.bet.HomeOdds, parseAzuroDecimalOdds("1.94"));
    assert.equal(mapped!.bet.AwayOdds, parseAzuroDecimalOdds("1.72"));
    assert.equal(mapped!.bet.Status, "Normal");
  });
});
