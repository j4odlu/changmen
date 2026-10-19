import { afterEach, expect, it, vi } from "vitest";
import { computed } from "vue";
import { clearRayMapOutcomes, lookupRayMapOutcome, retainRayMapOutcomes, updateRayMapOutcomes } from "./rayMapOutcome";
import { loadRayBets } from "./markets";
import type { RayOddsPayload } from "./shared/save_bets";
import { directGet } from "@changmen/client-core/shared/http";

vi.mock("@changmen/client-core/shared/http", () => ({ directGet: vi.fn() }));
vi.mock("@changmen/client-core/bridge/oddsAccess", () => ({ saveVenueOdds: vi.fn() }));

// 2026-10-19 RAY 38457365：两图的真实盘口 ID、分组及胜负字段。
const payload = (): RayOddsPayload => ({ id: 38457365,
  team: [{ pos: 1, team_id: 38456820 }, { pos: 2, team_id: 38020689 }],
  odds: [
    { odds_group_id: 16854, odds_id: 76661673, team_id: 38456820, match_stage: "map1", status: 5, win: 1, group_name: "获胜者", odds: 1.56 },
    { odds_group_id: 16854, odds_id: 76661674, team_id: 38020689, match_stage: "map1", status: 5, win: 0, group_name: "获胜者", odds: 2.37 },
    { odds_group_id: 16877, odds_id: 76661829, team_id: 38456820, match_stage: "map2", status: 5, win: 0, group_name: "获胜者", odds: 14.29 },
    { odds_group_id: 16877, odds_id: 76661830, team_id: 38020689, match_stage: "map2", status: 5, win: 1, group_name: "获胜者", odds: 1 },
  ],
});
const query = { matchId: "38457365", map: 1, betId: "16854", homeId: "76661673", awayId: "76661674" };
const update = (data = payload()) => updateRayMapOutcomes(query.matchId, data, /^获胜者$/, "cs2");
afterEach(() => { clearRayMapOutcomes(); vi.clearAllMocks(); });

it("reads both map winners by native odd IDs, including reversed merged teams", () => {
  update();
  expect(lookupRayMapOutcome(query)).toBe("Home");
  expect(lookupRayMapOutcome({ ...query, homeId: query.awayId, awayId: query.homeId })).toBe("Away");
  expect(lookupRayMapOutcome({ ...query, map: 2, betId: "16877", homeId: "76661829", awayId: "76661830" })).toBe("Away");
  for (const extra of [{ map: 0 }, { map: 2 }, { betId: "other" }, { matchId: "other" }, { homeId: "other" }, { awayId: "other" }])
    expect(lookupRayMapOutcome({ ...query, ...extra })).toBeNull();
});

it.each([
  (data: RayOddsPayload) => { data.odds![0]!.win = -1; },
  (data: RayOddsPayload) => { delete data.odds![0]!.win; },
  (data: RayOddsPayload) => { data.odds![1]!.win = 1; },
  (data: RayOddsPayload) => { data.odds![0]!.status = 4; },
  (data: RayOddsPayload) => { data.odds![0]!.status = 1; },
  (data: RayOddsPayload) => { data.odds![1]!.team_id = 38456820; },
  (data: RayOddsPayload) => { data.odds![1]!.odds_id = 76661673; },
  (data: RayOddsPayload) => { data.odds!.splice(1, 1); },
  (data: RayOddsPayload) => { data.odds!.push({ ...data.odds![0] }); },
  (data: RayOddsPayload) => { data.id = "other"; },
  (data: RayOddsPayload) => { data.team = []; },
  (data: RayOddsPayload) => { data.odds = data.odds!.map(row => ({ ...row, odds_group_id: 999999, group_name: "第一手枪局获胜者" })); },
])("rejects unknown, inconsistent or unrelated outcomes and retracts a corrected result (%#)", mutate => {
  update();
  const data = payload(); mutate(data); update(data);
  expect(lookupRayMapOutcome(query)).toBeNull();
});

it("updates mounted readers and clears removed matches and collector sessions", () => {
  const result = computed(() => lookupRayMapOutcome(query));
  expect(result.value).toBeNull(); update(); expect(result.value).toBe("Home");
  const corrected = payload(); corrected.odds![0]!.win = 0; corrected.odds![1]!.win = 1;
  update(corrected); expect(result.value).toBe("Away");
  retainRayMapOutcomes([query.matchId]); expect(result.value).toBe("Away");
  retainRayMapOutcomes([]); expect(result.value).toBeNull();
  update(); clearRayMapOutcomes(); expect(result.value).toBeNull();
});

it("uses exactly the existing odds request and retains the original SaveBet output", async () => {
  vi.mocked(directGet).mockResolvedValue({ code: 200, result: payload() });
  const { bets: rows, matchResult } = await loadRayBets({ Gateway: "https://ray.example/v2", Token: "test" }, query.matchId, /^获胜者$/, "cs2");
  expect(matchResult).toMatchObject({ id: 38457365, team: payload().team, odds: payload().odds!.map(({ odds, ...row }) => row) });
  expect(directGet).toHaveBeenCalledOnce();
  expect(vi.mocked(directGet).mock.calls[0]![0]).toBe("https://ray.example/v2/odds?match_id=38457365");
  expect(rows.map(row => [row.Map, row.SourceHomeID, row.SourceAwayID, row.Status])).toEqual([
    [1, "76661673", "76661674", "Locked"], [2, "76661829", "76661830", "Locked"],
  ]);
  expect(rows.every(row => !("win" in row))).toBe(true);
  expect(lookupRayMapOutcome(query)).toBe("Home");
});
