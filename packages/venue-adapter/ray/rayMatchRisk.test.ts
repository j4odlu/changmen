import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { RayOddsPayload } from "./shared/save_bets";

const now = Date.UTC(2026, 9, 19, 0);
const match = { id: 19001, providers: { RAY: "910001" } };
type Payload = RayOddsPayload & { status: number; round: string; start_time: string };
function payload(bo = 3): Payload {
  return { id: "910001", status: 1, round: `bo${bo}`, start_time: "2026-10-19 09:00:00",
    team: [{ pos: 1, team_id: "h" }, { pos: 2, team_id: "a" }],
    odds: Array.from({ length: bo }, (_, i) => [
      { odds_group_id: 100 + i, odds_id: `h${i}`, team_id: "h", match_stage: `map${i + 1}`, group_name: "获胜者", status: i === bo - 1 ? 5 : 1, win: i === bo - 1 ? 1 : -1 },
      { odds_group_id: 100 + i, odds_id: `a${i}`, team_id: "a", match_stage: `map${i + 1}`, group_name: "获胜者", status: i === bo - 1 ? 5 : 1, win: i === bo - 1 ? 0 : -1 },
    ]).flat() };
}
let storage: Map<string, string>;
beforeEach(() => {
  vi.resetModules(); storage = new Map();
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value) });
});
afterEach(() => vi.unstubAllGlobals());

it.each([3, 5, 7])("latches only the final-map-first anomaly for BO%s, including maps outside trading whitelists", async bo => {
  const risk = await import("./rayMatchRisk");
  expect(risk.isRayMatchRiskClosed(match)).toBe(false);
  risk.updateRayMatchRisk("910001", payload(bo), /^获胜者$/, "cs2", now);
  expect(risk.isRayMatchRiskClosed(match)).toBe(true);
  expect(risk.isRayMatchRiskClosed({ id: 19002, providers: { RAY: "910002" } })).toBe(false);
});

it.each([
  (p: Payload) => { p.round = "bo1"; },
  (p: Payload) => { p.round = ""; },
  (p: Payload) => { p.status = 2; },
  (p: Payload) => { p.start_time = "2026-10-19 07:59:59"; },
  (p: Payload) => { p.start_time = "invalid"; },
  (p: Payload) => { p.id = "another"; },
  (p: Payload) => { p.odds!.splice(0, 2); },
  (p: Payload) => { p.odds![0]!.win = 1; p.odds![0]!.status = 5; },
  (p: Payload) => { delete p.odds![0]!.win; },
  (p: Payload) => { p.odds![4]!.win = -1; },
  (p: Payload) => { p.odds![5]!.win = 1; },
  (p: Payload) => { p.odds![4]!.status = 4; },
  (p: Payload) => { p.odds![4]!.group_name = "第一手枪局获胜者"; },
  (p: Payload) => { p.odds![5]!.team_id = "h"; },
  (p: Payload) => { p.odds!.push({ ...p.odds![0] }); },
  (p: Payload) => { p.team = []; },
])("does not treat missing, partial, live, ordinary completed-map or ambiguous data as this anomaly (%#)", async change => {
  const risk = await import("./rayMatchRisk"); const p = payload(); change(p);
  risk.updateRayMatchRisk("910001", p, /^获胜者$/, "cs2", now);
  expect(risk.isRayMatchRiskClosed(match)).toBe(false);
});

it("survives refresh, re-merge, RAY source removal, later normal data and crossing kickoff", async () => {
  let risk = await import("./rayMatchRisk");
  risk.updateRayMatchRisk("910001", payload(), /^获胜者$/, "cs2", now);
  expect(risk.isRayMatchRiskClosed(match)).toBe(true);
  risk.updateRayMatchRisk("910001", { ...payload(), odds: [] }, /^获胜者$/, "cs2", now + 86400000);
  vi.resetModules(); risk = await import("./rayMatchRisk");
  expect(risk.isRayMatchRiskClosed({ id: match.id })).toBe(true);
  expect(risk.isRayMatchRiskClosed({ ...match, id: 19005 })).toBe(true);
  expect(risk.isRayMatchRiskClosed({ id: 19006 })).toBe(false);
  expect(JSON.parse(storage.get(risk.RAY_MATCH_RISK_STORAGE_KEY)!)).toEqual(expect.arrayContaining(["910001", "match:19001"]));
});

it("receives the same odds payload without additional HTTP through the existing outcome ingestion", async () => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  try {
    const { updateRayMapOutcomes, clearRayMapOutcomes } = await import("./rayMapOutcome");
    updateRayMapOutcomes("910001", payload(), /^获胜者$/, "cs2");
    clearRayMapOutcomes();
    expect((await import("./rayMatchRisk")).isRayMatchRiskClosed(match)).toBe(true);
  }
  finally { vi.useRealTimers(); }
});

it("restores storage only during initialization and keeps normal submission lookups in memory", async () => {
  const getItem = vi.fn(() => "[]"); const setItem = vi.fn();
  vi.stubGlobal("localStorage", { getItem, setItem });
  const risk = await import("./rayMatchRisk");
  expect(getItem).toHaveBeenCalledOnce();
  for (let i = 0; i < 1000; i++) expect(risk.isRayMatchRiskClosed(match)).toBe(false);
  expect(getItem).toHaveBeenCalledOnce();
  expect(setItem).not.toHaveBeenCalled();
});

it("still closes for this session when browser storage is unavailable", async () => {
  vi.stubGlobal("localStorage", { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("full"); } });
  const risk = await import("./rayMatchRisk");
  expect(() => risk.updateRayMatchRisk("910001", payload(), /^获胜者$/, "cs2", now)).not.toThrow();
  expect(risk.isRayMatchRiskClosed(match)).toBe(true);
});

it("invalidates already rendered and scanned eligibility immediately when the response arrives", async () => {
  const { computed } = await import("vue");
  const risk = await import("./rayMatchRisk");
  const eligible = computed(() => !risk.isRayMatchRiskClosed(match));
  expect(eligible.value).toBe(true);
  risk.updateRayMatchRisk("910001", payload(), /^获胜者$/, "cs2", now);
  expect(eligible.value).toBe(false);
});
