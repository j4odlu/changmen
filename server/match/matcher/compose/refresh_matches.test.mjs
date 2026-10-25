import { beforeEach, expect, it } from "vitest";
import { installPlugin, pmOb, pmRay, rawOb, rawRay, makeBets } from "../tests/fixtures.mjs";
import { refreshExistingMatches } from "./refresh_matches.js";
import { composeFromSnapshot, runMatchPass } from "./pipeline.js";

const original = { id: 42, merge_key: "match:id:3:100297:100631", game_id: "3", game: "CS2",
  title: "Ninjas in Pyjamas vs K27", start_time: pmOb.StartTime, bo: 3, round: 0,
  matchs: { OB: "ob1", RAY: "ray1" }, reverse: [],
  home_gb_team_id: "100631", away_gb_team_id: "100297", bets: [{ ID: 172032, Map: 0,
    Sources: { OB: rawOb, RAY: rawRay } }] };
function snapshot(matches) {
  return { matches, clientRows: [structuredClone(original)], alignClientRows: [structuredClone(original)], timers: {},
    bets: makeBets({ OB: { 0: rawOb }, RAY: { 0: rawRay, 1: { ...rawRay, BetID: "r1" } } }) };
}
beforeEach(installPlugin);

it("refreshes prematch and live singletons while preserving and locking absent venue markets", () => {
  for (const round of [0, 1]) {
    const input = snapshot({ RAY: { ray1: { ...pmRay, IsLive: 1 } } });
    input.clientRows[0].round = round;
    const before = structuredClone(input);
    const [match] = refreshExistingMatches([], input);
    expect(match.ID).toBe(42);
    expect(match.Matchs).toEqual(original.matchs);
    expect(match.Bets.find(b => b.Map === (round ? 1 : 0)).Sources.RAY.HomeID).toBe(rawRay.HomeID);
    expect(match.Bets.find(b => b.Map === 0).Sources.OB).toMatchObject({ BetID: rawOb.BetID,
      Status: "Locked", HomeID: "", AwayID: "", HomeOdds: 0, AwayOdds: 0 });
    expect(input).toEqual(before);
  }
});

it("keeps an unended match when all venues disappear, locking every source until the end rules apply", () => {
  const [match] = refreshExistingMatches([], snapshot({}));
  expect(match.ID).toBe(42);
  expect(match.Matchs).toEqual(original.matchs);
  expect(match.Bets[0].ID).toBe(original.bets[0].ID);
  for (const source of Object.values(match.Bets[0].Sources))
    expect(source).toMatchObject({ Status: "Locked", HomeID: "", AwayID: "", HomeOdds: 0, AwayOdds: 0 });
  expect(refreshExistingMatches([], snapshot({}), { endedIds: [42] })).toEqual([]);
});

it("keeps native locked quotes and manual direction using the same market ID", () => {
  const input = snapshot({ RAY: { ray1: pmRay } });
  input.bets["RAY:ray1"][0].Status = "Locked";
  input.platformOverrides = { 42: { RAY: "force_reversed" } };
  const [match] = refreshExistingMatches([], input);
  expect(match.Bets.find(b => b.Map === 0)).toMatchObject({ ID: 172032,
    Sources: { RAY: { Status: "Locked", HomeID: rawRay.AwayID } } });
  expect(match.Reverse).toContain("RAY");
});

it("does not revive ended identities or lower the new-match two-venue threshold", () => {
  const input = snapshot({ RAY: { ray1: pmRay } });
  input.clientRows[0].ended_at = 100;
  expect(refreshExistingMatches([], input)).toEqual([]);
  const fresh = { ...input, clientRows: [], alignClientRows: [] };
  expect(composeFromSnapshot(fresh).list).toEqual([]);
  expect(runMatchPass([{ ID: -1, Matchs: { RAY: "ray1" } }], fresh, { allowExistingSingle: true }).info).toEqual([]);
});

it("preserves locked markets in the ordinary row across cycles and restores native options when venues return", () => {
  const input = snapshot({ RAY: { ray1: pmRay } });
  input.clientRows[0].bets.push({ ID: 172034, Map: 2, Sources: { OB: { ...rawOb, BetID: "ob-map2" } } });
  const [first] = refreshExistingMatches([], input);
  input.clientRows[0].bets = first.Bets;
  expect(refreshExistingMatches([], input)[0].Bets.find(b => b.Map === 2).Sources.OB.HomeID).toBe("");
  input.matches.OB = { ob1: pmOb };
  const [recovered] = refreshExistingMatches([], input);
  expect(recovered.ID).toBe(42);
  expect(recovered.Bets.find(b => b.Map === 0).Sources.OB).toMatchObject({ Status: "Normal", HomeID: rawOb.HomeID });
});

it("refreshes the names of retained markets after a manual home-away swap", () => {
  const input = snapshot({ RAY: { ray1: pmRay } });
  input.clientRows[0].bets.push({ ID: 172034, Map: 2, HomeName: "Ninjas in Pyjamas", AwayName: "K27",
    Sources: { OB: { ...rawOb, BetID: "ob-map2" } } });
  const row = input.clientRows[0];
  [row.home_gb_team_id, row.away_gb_team_id] = [row.away_gb_team_id, row.home_gb_team_id];
  row.title = "K27 vs Ninjas in Pyjamas";
  const [match] = refreshExistingMatches([], input, { stickyOrientation: true });
  expect(match.Title).toBe(row.title);
  expect(match.Bets.find(b => b.Map === 2)).toMatchObject({ ID: 172034, HomeName: "K27", AwayName: "Ninjas in Pyjamas" });
});
