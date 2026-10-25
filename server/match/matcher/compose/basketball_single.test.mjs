import { beforeEach, expect, it } from "vitest";
import { composeFromSnapshot, runMatchPass, runEndPass } from "./pipeline.js";
import { clientMatchWriteRow } from "./write_payload.js";
import { installPlugin, pmRay } from "../tests/fixtures.mjs";
import { filterMultiPlatform } from "./shape/live_shape.js";
import { checkHomeSlotConsistency, checkUnlockedEmpty } from "./invariants.js";
import { setTeamPlugin } from "@changmen/shared/match-identity/teams/team_key.js";

const ray = { SourceMatchID: "basket1", SourceGameID: 1072082, Home: "Melbourne United", Away: "Sydney Kings",
  HomeID: "21269919", AwayID: "21269928", StartTime: Date.now() + 3600000, BO: 0 };
const quote = { Map: 0, SourceBetID: "1279801", SourceHomeID: "h1", SourceAwayID: "a1", HomeOdds: 1.8, AwayOdds: 2.1, Status: "Normal" };
function snapshot(extra = {}) {
  return { matches: { RAY: { basket1: { ...ray } } }, bets: { "RAY:basket1": [quote] }, timers: {}, clientRows: [], ...extra };
}
function compose(input) {
  const { list } = composeFromSnapshot(input);
  return runEndPass(runMatchPass(list, input).info, input).info;
}
beforeEach(installPlugin);

it("creates a single RAY basketball match without canonical team mappings and keeps native full-match sides", () => {
  const input = snapshot();
  const [row] = compose(input);
  expect(row).toMatchObject({ Game: "篮球", GameID: "10001", Matchs: { RAY: "basket1" }, BO: 0, Round: 0, Reverse: [] });
  expect(row.Title).toBe("Melbourne United vs Sydney Kings");
  expect(row.Bets).toHaveLength(1);
  expect(row.Bets[0]).toMatchObject({ Map: 0, Sources: { RAY: { HomeID: "h1", AwayID: "a1", HomeOdds: 1.8, AwayOdds: 2.1 } } });
  expect(checkUnlockedEmpty(row).ok).toBe(true);
  expect(checkHomeSlotConsistency(row, { "RAY:0": { HomeID: "h1", AwayID: "a1" } }).ok).toBe(true);
  const invalid = structuredClone(row);
  invalid.Bets[0].Sources.OB = { ...invalid.Bets[0].Sources.RAY };
  expect(checkUnlockedEmpty(invalid).ok).toBe(false);
  const stored = clientMatchWriteRow({ ...row, ID: 42 }, Date.now());
  expect(stored).toMatchObject({ game_id: "10001", matchs: { RAY: "basket1" }, home_gb_team_id: 0, away_gb_team_id: 0 });
});

it("reuses the changmen ID on the next cycle and respects explicit end status", () => {
  const input = snapshot();
  const first = compose(input)[0];
  const stored = clientMatchWriteRow({ ...first, ID: 42 }, Date.now());
  input.clientRows = [stored];
  expect(compose(input)).toHaveLength(1);
  expect(compose(input)[0].ID).toBe(42);
  stored.ended_at = Date.now();
  expect(compose(input)).toEqual([]);
});

it("keeps same-team games from the same venue separate and rejects invalid singletons", () => {
  const input = snapshot();
  input.matches.RAY.basket2 = { ...ray, SourceMatchID: "basket2", StartTime: ray.StartTime + 3600000 };
  expect(compose(input)).toHaveLength(2);
  for (const invalid of [{ Home: "" }, { AwayID: ray.HomeID }, { StartTime: 0 }])
    expect(compose(snapshot({ matches: { RAY: { basket1: { ...ray, ...invalid } } } }))).toEqual([]);
});

it("does not relax new-match thresholds for the original esports or publish empty mappings", () => {
  for (const game of ["lol", "cs2", "dota2", "kog", "valorant"]) {
    expect(filterMultiPlatform([{ Game: game, Round: 0, Matchs: { RAY: "one" } }])).toEqual([]);
  }
  expect(compose(snapshot({ matches: { RAY: { ray1: pmRay } } }))).toEqual([]);
  expect(filterMultiPlatform([{ Game: "篮球", Matchs: {} }])).toEqual([]);
  expect(filterMultiPlatform([{ Game: "篮球", Matchs: { RAY: "one" } }])).toHaveLength(1);
});

it("keeps missing or incomplete full-match quotes empty while still delivering the match", () => {
  for (const bets of [{}, { "RAY:basket1": [{ ...quote, SourceAwayID: "" }] }]) {
    const [row] = compose(snapshot({ bets }));
    expect(row).toBeDefined();
    expect(row.Bets).toEqual([]);
  }
});

it("keeps NBA2K separate from real basketball with the same base team names and start time", () => {
  const input = snapshot();
  input.matches.RAY.basket1 = { ...ray, Home: `${ray.Home}(NBA2K)`, Away: `${ray.Away}(NBA2K)` };
  input.matches.Polymarket = { realBasket: { ...ray, SourceMatchID: "realBasket", SourceGameID: "basketball",
    HomeID: "basketball:melbourne-united", AwayID: "basketball:sydney-kings" } };
  input.bets["Polymarket:realBasket"] = [{ ...quote, SourceBetID: "real-full", SourceHomeID: "real-home", SourceAwayID: "real-away" }];
  const rows = compose(input);
  expect(rows).toHaveLength(2);
  expect(rows.map(row => row.Matchs)).toEqual(expect.arrayContaining([{ RAY: "basket1" }, { Polymarket: "realBasket" }]));
  const real = rows.find(row => row.Matchs.Polymarket);
  expect(real.Bets[0].Sources).toMatchObject({ Polymarket: { HomeID: "real-home", AwayID: "real-away" } });
  expect(real.Bets[0].Sources.RAY).toBeUndefined();
});

it("uses existing team mappings to attach PM to the original basketball match and aligns opposite venue directions", () => {
  setTeamPlugin({
    lookupById: (p, id) => ({ "RAY:21269919": "91001", "RAY:21269928": "91002",
      "Polymarket:basketball:sydney-kings": "91002", "Polymarket:basketball:melbourne-united": "91001" })[`${p}:${id}`] || null,
    lookupByName: () => null,
    lookupCanonicalName: id => ({ "91001": "Melbourne United", "91002": "Sydney Kings" })[id] || null,
    lookupGameForGbTeamId: () => "basketball",
  });
  const input = snapshot();
  const old = { ...clientMatchWriteRow({ ...compose(input)[0], ID: 42 }, Date.now()), home_gb_team_id: null, away_gb_team_id: null };
  input.clientRows = [old];
  input.matches.Polymarket = { pmBasket: { SourceMatchID: "pmBasket", SourceGameID: "basketball", Home: "Sydney Kings", Away: "Melbourne United",
    HomeID: "basketball:sydney-kings", AwayID: "basketball:melbourne-united", StartTime: ray.StartTime } };
  input.bets["Polymarket:pmBasket"] = [{ Map: 0, SourceBetID: "pm-full", SourceHomeID: "sydney-token", SourceAwayID: "melbourne-token",
    HomeOdds: 2.2, AwayOdds: 1.8, Status: "Normal" }];
  const [row] = compose(input);
  expect(row.ID).toBe(42);
  expect(row.Matchs).toEqual({ RAY: "basket1", Polymarket: "pmBasket" });
  expect(row.Title).toBe("Sydney Kings vs Melbourne United");
  expect(row.Reverse).toContain("RAY");
  expect(row.Bets).toHaveLength(1);
  expect(row.Bets[0].Sources).toMatchObject({
    RAY: { HomeID: "a1", AwayID: "h1" }, Polymarket: { HomeID: "sydney-token", AwayID: "melbourne-token" },
  });
});
