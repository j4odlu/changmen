import { beforeEach, expect, it } from "vitest";
import { composeFromSnapshot, runMatchPass, runEndPass } from "./pipeline.js";
import { clientMatchWriteRow } from "./write_payload.js";
import { installPlugin, pmRay } from "../tests/fixtures.mjs";
import { filterMultiPlatform } from "./shape/live_shape.js";
import { checkUnlockedEmpty } from "./invariants.js";
import { setTeamPlugin } from "@changmen/shared/match-identity/teams/team_key.js";

const ray = { SourceMatchID: "basket1", SourceGameID: 1072082, Home: "Melbourne United", Away: "Sydney Kings",
  HomeID: "21269919", AwayID: "21269928", StartTime: Date.now() + 3600000, BO: 0 };
const pm = { SourceMatchID: "pmBasket", SourceGameID: "basketball", Home: "Sydney Kings", Away: "Melbourne United",
  HomeID: "basketball:sydney-kings", AwayID: "basketball:melbourne-united", StartTime: ray.StartTime };
const quote = { Map: 0, SourceBetID: "1279801", SourceHomeID: "h1", SourceAwayID: "a1", HomeOdds: 1.8, AwayOdds: 2.1, Status: "Normal" };
function snapshot(extra = {}) {
  return { matches: { RAY: { basket1: { ...ray } } }, bets: { "RAY:basket1": [quote] }, timers: {}, clientRows: [], ...extra };
}
function compose(input) {
  const { list } = composeFromSnapshot(input);
  return runEndPass(runMatchPass(list, input).info, input).info;
}
function addPm(input) {
  input.matches.Polymarket = { pmBasket: { ...pm } };
  input.bets["Polymarket:pmBasket"] = [{ Map: 0, SourceBetID: "pm-full", SourceHomeID: "sydney-token", SourceAwayID: "melbourne-token",
    HomeOdds: 2.2, AwayOdds: 1.8, Status: "Normal" }];
}
function installBasketballTeams() {
  setTeamPlugin({
    lookupById: (p, id) => ({ "RAY:21269919": "91001", "RAY:21269928": "91002",
      "Polymarket:basketball:sydney-kings": "91002", "Polymarket:basketball:melbourne-united": "91001" })[`${p}:${id}`] || null,
    lookupByName: () => null,
    lookupCanonicalName: id => ({ "91001": "Melbourne United", "91002": "Sydney Kings" })[id] || null,
    lookupGameForGbTeamId: () => "basketball",
  });
}
beforeEach(installPlugin);

it("does not create new basketball matches from RAY alone or PM alone", () => {
  expect(compose(snapshot())).toEqual([]);
  const input = snapshot({ matches: {}, bets: {} }); addPm(input);
  expect(compose(input)).toEqual([]);
});

it("requires two venues for prematch basketball and all original esports", () => {
  for (const game of ["篮球", "basketball", "lol", "cs2", "dota2", "kog", "valorant"])
    expect(filterMultiPlatform([{ Game: game, Round: 0, Matchs: { RAY: "one" } }])).toEqual([]);
  expect(compose(snapshot({ matches: { RAY: { ray1: pmRay } } }))).toEqual([]);
  expect(filterMultiPlatform([{ Game: "篮球", Matchs: {} }])).toEqual([]);
});

it("does not merge NBA2K with real basketball with the same base names and start time", () => {
  const input = snapshot(); addPm(input);
  input.matches.RAY.basket1 = { ...ray, Home: `${ray.Home}(NBA2K)`, Away: `${ray.Away}(NBA2K)` };
  expect(compose(input)).toEqual([]);
});

it("uses normal team mappings to merge RAY and PM and align opposite venue directions", () => {
  installBasketballTeams();
  const input = snapshot(); addPm(input);
  const [row] = compose(input);
  expect(row.Matchs).toEqual({ RAY: "basket1", Polymarket: "pmBasket" });
  expect(row.Title).toBe("Sydney Kings vs Melbourne United");
  expect(row.Reverse).toContain("RAY");
  expect(row.Bets[0].Sources).toMatchObject({ RAY: { HomeID: "a1", AwayID: "h1" },
    Polymarket: { HomeID: "sydney-token", AwayID: "melbourne-token" } });
  expect(checkUnlockedEmpty(row).ok).toBe(true);
  const stored = clientMatchWriteRow({ ...row, ID: 42 }, Date.now());
  input.clientRows = [stored];
  expect(compose(input)[0].ID).toBe(42);
  stored.ended_at = Date.now();
  expect(compose(input)).toEqual([]);
});

it("reuses a historical single-venue identity when a second mapped venue arrives", () => {
  installBasketballTeams();
  const input = snapshot(); addPm(input);
  const stored = clientMatchWriteRow({ ...compose(input)[0], ID: 42, MergeKey: "match:single:basketball:RAY:basket1",
    Matchs: { RAY: "basket1" } }, Date.now());
  stored.home_gb_team_id = null; stored.away_gb_team_id = null;
  input.clientRows = [stored];
  const [row] = compose(input);
  expect(row.ID).toBe(42);
  expect(row.Matchs).toEqual({ RAY: "basket1", Polymarket: "pmBasket" });
  expect(Object.keys(row.Bets[0].Sources)).toHaveLength(2);
});
