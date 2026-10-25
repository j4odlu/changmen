import { beforeEach, expect, it, vi } from "vitest";
import { installPlugin, makeBets, pmOb, pmPm, pmRay, rawOb, rawRay } from "../tests/fixtures.mjs";

const state = vi.hoisted(() => ({ rows: [], matches: {}, bets: {}, writes: [], inserts: vi.fn() }));
vi.mock("./io/snapshot.js", () => ({
  loadSnapshot: async () => structuredClone({ matches: state.matches, clientRows: state.rows,
    alignClientRows: state.rows, bets: state.bets, timers: {} }),
}));
vi.mock("@changmen/db", () => ({
  DEFAULT_CLIENT_MATCH_ARCHIVE_INTERVAL_MS: 3600000,
  isMatcherStoreReady: () => true,
  getClientMatchIdAdapter: () => ({
    fetchClientMatchIndex: async () => state.rows.filter(row => row.ended_at == null),
    findClientMatchIdByMergeKey: async key => state.rows.find(row => row.ended_at == null && row.merge_key === key)?.id,
    insertClientMatchStub: state.inserts,
  }),
}));
vi.mock("./io/write.js", () => ({
  writeClientMatches: async (active, now, { endedRows, markEndedIds }) => {
    state.writes.push(structuredClone({ active, endedRows, markEndedIds }));
    const ended = new Set([...markEndedIds, ...endedRows.map(row => row.ID)]);
    for (const row of state.rows) if (ended.has(Number(row.id))) row.ended_at ??= now;
  },
}));
vi.mock("../ops/backfill_platform_match_ids.js", () => ({
  backfillPlatformMatchIdsForIdMerges: async () => ({ updated: 0 }),
}));
vi.mock("../lib/write_guard.js", async original => ({
  ...await original(), assertComposerMayWrite: () => ({ ok: true }),
}));
import { composeOnce } from "./compose_once.js";

const start = Date.now() - 3600000;
const links = { OB: "ob1", RAY: "ray1", Polymarket: "pm1" };
function row(id, ended_at, pm_sport = null) {
  return { id, ended_at, pm_sport, start_time: start, title: "Ninjas in Pyjamas vs K27",
    game_id: "3", merge_key: `match:id:3:100297:100631${ended_at ? `@ended:${id}` : ""}`,
    matchs: { ...links }, home_gb_team_id: "100631", away_gb_team_id: "100297" };
}
function sources(boundId) {
  return Object.fromEntries([["OB", pmOb], ["RAY", pmRay], ["Polymarket", pmPm]].map(([platform, value]) =>
    [platform, { [value.SourceMatchID]: { ...value, StartTime: start,
      ...(boundId == null ? {} : { ClientMatchId: boundId }) } }]));
}
beforeEach(() => {
  installPlugin();
  state.rows = [];
  state.writes = [];
  state.matches = {};
  state.bets = {};
  state.inserts.mockReset().mockImplementation(async () => { throw new Error("unexpected new match"); });
});

function closedMarkets() {
  return makeBets({
    OB: { 0: { ...rawOb, Status: "Locked" }, 1: { ...rawOb, BetID: "m1", Status: "Locked" } },
    RAY: { 0: { ...rawRay, Status: "Locked" }, 1: { ...rawRay, BetID: "r1", Status: "Locked" } },
  });
}

it("checks the original end rules for an existing match even when only one venue is matched this cycle", async () => {
  const existing = row(42, null);
  delete existing.matchs.Polymarket;
  state.rows = [existing];
  state.matches = { OB: { ob1: { ...pmOb, StartTime: start, IsLive: 1 } } };
  state.bets = closedMarkets();
  const result = await composeOnce({ write: true, viaMatcherWriter: true, registerTeams: false });
  expect(result.endedCount).toBe(1);
  expect(result.info).toEqual([]);
  expect(state.rows[0].ended_at).toBeGreaterThan(0);
  expect(state.writes[0].active).toEqual([]);
  expect(state.rows[0].matchs).toEqual({ OB: "ob1", RAY: "ray1" });
  expect(state.inserts).not.toHaveBeenCalled();
});

it("uses the stored PM mapping when its snapshot is absent, keeping a PM-unended match active", async () => {
  state.rows = [row(42, null, { eventId: "pm1", ended: false, status: "inprogress" })];
  state.matches = sources(42);
  delete state.matches.Polymarket;
  state.matches.OB.ob1.IsLive = 1;
  state.matches.RAY.ray1.IsLive = 1;
  state.bets = closedMarkets();
  const result = await composeOnce({ write: true, viaMatcherWriter: true, registerTeams: false });
  expect(result.endedCount).toBe(0);
  expect(result.info.map(match => match.ID)).toEqual([42]);
  expect(state.rows[0].ended_at).toBeNull();
  expect(state.writes[0].active[0].Matchs).toEqual(links);
  expect(state.inserts).not.toHaveBeenCalled();
});

it("still ends a PM-confirmed match with a missing PM snapshot and closed remaining venues", async () => {
  state.rows = [row(42, null, { eventId: "pm1", ended: true, status: "finished" })];
  state.matches = sources(42);
  delete state.matches.Polymarket;
  state.matches.OB.ob1.IsLive = 1;
  state.bets = closedMarkets();
  const result = await composeOnce({ write: true, viaMatcherWriter: true, registerTeams: false });
  expect(result.endedCount).toBe(1);
  expect(result.info).toEqual([]);
  expect(state.rows[0].matchs).toEqual(links);
  expect(state.rows[0].ended_at).toBeGreaterThan(0);
  expect(state.inserts).not.toHaveBeenCalled();
});

it("ends the original ID once and does not allocate another ID across repeated collector refreshes", async () => {
  state.rows = [row(8676, null, { eventId: "pm1", source: "ws", ended: true, status: "finished" })];
  state.matches = sources(8676);
  await composeOnce({ write: true, viaMatcherWriter: true, registerTeams: false });
  expect(state.rows[0].ended_at).toBeGreaterThan(0);
  expect(state.writes[0].active).toEqual([]);
  expect([...state.writes[0].markEndedIds, ...state.writes[0].endedRows.map(r => r.ID)]).toContain(8676);
  const committed = structuredClone(state.rows);
  for (let cycle = 0; cycle < 30; cycle++) {
    // 收录同一批源，交替模拟保留关联、关联字段丢失、旧缓存指针残留。
    state.matches = sources([8676, null, 99999][cycle % 3]);
    const result = await composeOnce({ write: true, viaMatcherWriter: true, registerTeams: false });
    expect(result.info).toEqual([]);
    expect(result.endedCount).toBe(0);
  }
  expect(state.inserts).not.toHaveBeenCalled();
  expect(state.rows).toEqual(committed);
  expect(state.rows[0].matchs).toEqual(links);
});

it("finishes an existing duplicate with missing PM state, then keeps all duplicate sources out of new allocation", async () => {
  state.rows = [row(8676, start + 1000, { eventId: "pm1", ended: true, status: "finished" }), row(8733, null)];
  state.matches = sources(8733);
  await composeOnce({ write: true, viaMatcherWriter: true, registerTeams: false });
  expect(state.rows[1].ended_at).toBeGreaterThan(0);
  for (let cycle = 0; cycle < 3; cycle++) {
    state.matches = sources(null);
    await composeOnce({ write: true, viaMatcherWriter: true, registerTeams: false });
  }
  expect(state.inserts).not.toHaveBeenCalled();
  expect(state.rows).toHaveLength(2);
  expect(state.rows.every(r => r.ended_at != null)).toBe(true);
});
