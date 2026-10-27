import { beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rows: [], saved: {}, replace: vi.fn(), write: vi.fn(), prices: vi.fn(), record: vi.fn() }));
vi.mock("@changmen/db", () => ({ replacePlatformBetsForMatch: h.replace, writePlatformBets: h.write }));
vi.mock("@changmen/storage/json_file_store", () => ({
  readJsonFile: (name, fallback) => h.saved[name] ?? fallback,
  writeJsonFile: (name, data) => { h.saved[name] = structuredClone(data); }, writeJsonFileDebounced: vi.fn(),
}));
vi.mock("@changmen/storage/platform_storage", () => ({ ensureStorageSeed: vi.fn(), getPlatform: vi.fn(), setPlatform: vi.fn() }));
vi.mock("../db/store.js", () => ({ loadClientMatchesFromDb: async () => h.rows }));
vi.mock("./runtime.js", () => ({ installBackendMatcherRuntime: vi.fn() }));
vi.mock("../shared/adapter_paths.js", () => ({ adapterRequire: () => ({ isVpsOwnedPlatformCollect: provider => provider === "Polymarket" }) }));
vi.mock("../esport-api/default_odds.js", () => ({ createDefaultOddsApi: () => ({ recordFromMatchList: h.record }) }));
vi.mock("../esport-api/pm_prematch.js", () => ({ attachPmPrematchPrices: h.prices }));

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); h.saved = {}; h.rows = [];
  h.prices.mockImplementation(async rows => rows);
});

function result() {
  return { id: "910001", round: "bo3", status: 1, start_time: new Date(Date.now() + 3600000).toISOString(),
    team: [{ pos: 1, team_id: "h" }, { pos: 2, team_id: "a" }],
    odds: [1, 2, 3].flatMap(map => ["h", "a"].map((team, side) => ({
      group_name: "获胜者", match_stage: `map${map}`, odds_group_id: map,
      odds_id: `${team}${map}`, team_id: team, status: map === 3 ? 5 : 1, win: map === 3 ? 1 - side : -1,
    }))) };
}

it("uses the real SaveBet store and filters the entire match from every client list read", async () => {
  const store = await import("../esport-api/store.js");
  const blocked = { ID: 1, Matchs: { RAY: "910001", OB: "ob1" }, Bets: [{ ID: 10 }] };
  const normal = { ID: 2, Matchs: { RAY: "910002" }, Bets: [{ ID: 20 }] };
  h.rows = [blocked, normal];
  expect(await store.buildMatchList()).toEqual(h.rows);
  store.saveBets("RAY", "910001", [], result());
  expect(h.saved.ray_match_risks).toEqual(["RAY:910001"]);
  expect(await store.buildMatchList()).toEqual([normal]);
  expect(await store.buildMatchList()).toEqual([normal]);
  expect(h.record).toHaveBeenLastCalledWith([normal]);
  h.prices.mockRejectedValueOnce(new Error("price read unavailable"));
  expect(await store.buildMatchList()).toEqual([normal]);
  expect(h.rows).toEqual([blocked, normal]);
  h.rows = [{ ID: 1, Matchs: { OB: "ob1" } }, normal];
  expect(await store.buildMatchList()).toEqual([normal]);
});

it("preserves normal odds writes and ignores result metadata from other platforms", async () => {
  const store = await import("../esport-api/store.js");
  const bets = [{ SourceBetID: "b1", Map: 0, HomeOdds: 1.5, AwayOdds: 2.1, BetName: "获胜者" }];
  store.saveBets("OB", "910001", bets, result());
  expect(h.saved.ray_match_risks).toBeUndefined();
  expect(h.replace).toHaveBeenCalledWith("OB", "910001", expect.arrayContaining([expect.objectContaining({ SourceBetID: "b1" })]));
  store.saveBets("OB", "910001", []);
  expect(h.write).toHaveBeenCalledWith("OB", "910001", expect.arrayContaining([expect.objectContaining({ SourceBetID: "b1" })]));
  store.saveBets("Polymarket", "910001", bets, result());
  expect(h.replace).toHaveBeenCalledTimes(1);
  h.rows = [{ ID: 1, Matchs: { RAY: "910001" } }];
  expect(await store.buildMatchList()).toEqual(h.rows);
});
