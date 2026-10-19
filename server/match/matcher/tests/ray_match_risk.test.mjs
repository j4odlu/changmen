import { beforeEach, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({ data: [], read: vi.fn(), write: vi.fn() }));
vi.mock("@changmen/storage/json_file_store.js", () => ({ readJsonFile: storage.read, writeJsonFile: storage.write }));
const now = Date.UTC(2026, 9, 19, 0);
function payload(bo = 3) {
  return { id: "910001", status: 1, round: `bo${bo}`, start_time: "2026-10-19 09:00:00",
    team: [{ pos: 1, team_id: "h" }, { pos: 2, team_id: "a" }],
    odds: Array.from({ length: bo }, (_, i) => [
      { odds_group_id: 100 + i, odds_id: `h${i}`, team_id: "h", match_stage: `map${i + 1}`, group_name: "获胜者", status: i === bo - 1 ? 5 : 1, win: i === bo - 1 ? 1 : -1 },
      { odds_group_id: 100 + i, odds_id: `a${i}`, team_id: "a", match_stage: `map${i + 1}`, group_name: "获胜者", status: i === bo - 1 ? 5 : 1, win: i === bo - 1 ? 0 : -1 },
    ]).flat() };
}
beforeEach(() => {
  vi.resetModules(); storage.data = [];
  storage.read.mockReset().mockImplementation(() => structuredClone(storage.data));
  storage.write.mockReset().mockImplementation((name, data) => { storage.data = structuredClone(data); });
});

it.each([3, 5, 7])("detects final-map-first prematch BO%s from native results", async bo => {
  const risk = await import("../ray_match_risk.js");
  expect(risk.hasRayPrematchAnomaly("910001", payload(bo), now)).toBe(true);
  const p = payload(bo);
  p.odds = p.odds.map(row => ({ ...row, match_stage: row.match_stage.replace("map", "r"), win: String(row.win) }));
  expect(risk.hasRayPrematchAnomaly("910001", p, now)).toBe(true);
});

it.each([
  p => { p.round = "bo1"; }, p => { p.round = ""; }, p => { p.status = 2; },
  p => { p.start_time = "2026-10-19 07:59:59"; }, p => { p.start_time = "invalid"; },
  p => { p.id = "another"; }, p => { p.odds.splice(0, 2); },
  p => { p.odds[0].win = 1; p.odds[0].status = 5; }, p => { delete p.odds[0].win; },
  p => { p.odds[4].win = -1; }, p => { p.odds[5].win = 1; }, p => { p.odds[4].status = 4; },
  p => { p.odds[4].group_name = "第一手枪局获胜者"; }, p => { p.odds[5].team_id = "h"; },
  p => { p.odds.push({ ...p.odds[0] }); }, p => { p.team = []; }, p => { p.team[0] = null; },
  p => { p.odds = [null]; }, p => { p.odds[5].odds_group_id = 999; },
  p => { p.odds[5].odds_id = p.odds[4].odds_id; },
])("ignores incomplete, ambiguous, canceled, live or ordinary completed-map data (%#)", async change => {
  const risk = await import("../ray_match_risk.js"); const p = payload(); change(p);
  risk.observeRayMatchResult("910001", p, now);
  expect(risk.filterRayRiskMatches([{ ID: 1, Matchs: { RAY: "910001" } }])).toHaveLength(1);
  expect(storage.write).not.toHaveBeenCalled();
});

it("latches globally, survives restart and source re-merge, and leaves unrelated rows unchanged", async () => {
  let risk = await import("../ray_match_risk.js");
  const normal = { ID: 2, Matchs: { OB: "normal", RAY: "910002" }, Bets: ["untouched"] };
  const rows = [normal, { ID: 1, Matchs: { RAY: "910001", OB: "ob1" } }];
  const original = structuredClone(rows);
  risk.observeRayMatchResult("910001", payload(), now);
  expect(risk.filterRayRiskMatches(rows)).toEqual([normal]);
  expect(rows).toEqual(original);
  risk.observeRayMatchResult("910001", { ...payload(), status: 2, odds: [] }, now + 86400000);
  vi.resetModules(); risk = await import("../ray_match_risk.js");
  expect(risk.filterRayRiskMatches([normal, { ID: 1 }, { ID: 3, Matchs: { OB: "ob1" } }])).toEqual([normal]);
  const writes = storage.write.mock.calls.length;
  expect(risk.filterRayRiskMatches(rows)[0]).toBe(normal);
  expect(storage.write).toHaveBeenCalledTimes(writes);
});

it("blocks linked rows in either order before returning any match", async () => {
  const risk = await import("../ray_match_risk.js");
  risk.observeRayMatchResult("910001", payload(), now);
  expect(risk.filterRayRiskMatches([
    { ID: 3, Matchs: { OB: "ob1" } }, { ID: 1, Matchs: { RAY: "910001", OB: "ob1" } },
  ])).toEqual([]);
});

it("does not link unrelated matches through absent or invalid canonical IDs", async () => {
  const risk = await import("../ray_match_risk.js");
  risk.observeRayMatchResult("910001", payload(), now);
  const normal = { ID: 0, Matchs: { RAY: "910002" } };
  expect(risk.filterRayRiskMatches([{ ID: 0, Matchs: { RAY: "910001" } }, normal])).toEqual([normal]);
});

it("retries persistence on the next existing collection round after a write failure", async () => {
  const risk = await import("../ray_match_risk.js");
  storage.write.mockImplementationOnce(() => { throw new Error("disk full"); });
  expect(() => risk.observeRayMatchResult("910001", payload(), now)).toThrow("disk full");
  risk.observeRayMatchResult("910001", payload(), now);
  expect(risk.filterRayRiskMatches([{ ID: 1, Matchs: { RAY: "910001" } }])).toEqual([]);
});

it.each([null, [], "invalid", {}, { team: [null] }])("ignores malformed raw facts safely (%#)", async value => {
  const risk = await import("../ray_match_risk.js");
  expect(risk.hasRayPrematchAnomaly("910001", value, now)).toBe(false);
});
