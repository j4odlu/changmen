import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ snapshot: null, generation: 0 }));
vi.mock("@changmen/db/client_match_snapshot.js", () => ({
  loadClientMatchSnapshot: async () => state.snapshot,
  invalidateClientMatchSnapshot: () => { state.generation++; },
  getClientMatchSnapshotStats: () => ({ generation: state.generation }),
}));
import { loadClientMatchesFromDb } from "./store.js";
it("distinguishes cold query failure, confirmed empty and last confirmed data", async () => {
  await expect(loadClientMatchesFromDb()).rejects.toThrow("赛事列表暂不可用");
  state.snapshot = { rows: [] };
  await expect(loadClientMatchesFromDb()).resolves.toBeNull();
  state.snapshot = { rows: [{ id: "1", title: "A vs B", built_at: 1 }] };
  expect((await loadClientMatchesFromDb())[0].ID).toBe(1);
  state.snapshot = null;
  expect((await loadClientMatchesFromDb())[0].ID).toBe(1);
});

it("projects committed matches without deciding venue eligibility again for basketball or other esports", async () => {
  for (const platform of ["RAY", "Polymarket"]) {
    const row = { id: "42", title: "Melbourne United vs Sydney Kings", game: "篮球", game_id: "10001",
      matchs: { [platform]: "basket1" }, bets: [], built_at: 1 };
    state.snapshot = { rows: [row, { ...row, id: "43", game: "CS2", game_id: "3" }] };
    const before = structuredClone(state.snapshot);
    expect((await loadClientMatchesFromDb()).map(row => row.ID)).toEqual([42, 43]);
    expect(state.snapshot).toEqual(before);
    state.snapshot = null;
    expect((await loadClientMatchesFromDb()).map(row => row.ID)).toEqual([42, 43]);
  }
});

it("leaves venue eligibility to matcher for every basketball name and round", async () => {
  for (const game of ["篮球", "basketball", ""]) {
    state.snapshot = { rows: [{ id: "42", game, game_id: "10001", round: 1,
      matchs: { RAY: "basket1", Polymarket: " " }, bets: [], built_at: 1 }] };
    const [row] = await loadClientMatchesFromDb();
    expect(row).toMatchObject({ ID: 42, Game: game, GameID: 10001, Round: 1,
      Matchs: { RAY: "basket1", Polymarket: " " } });
  }
});

it("delivers basketball when two venues are linked and preserves its numeric game and native selections", async () => {
  const source = { Type: "RAY", BetID: "1279801", HomeID: "h1", AwayID: "a1", HomeOdds: 1.8, AwayOdds: 2.1, Status: "Normal" };
  state.snapshot = { rows: [{ id: "42", title: "Melbourne United vs Sydney Kings", game: "篮球", game_id: "10001",
    start_time: Date.now(), matchs: { RAY: "basket1", Polymarket: "pmBasket" }, reverse: [], bo: 0, round: 0,
    bets: [{ ID: 172032, Map: 0, Sources: { RAY: source } }], built_at: 1 }] };
  const [row] = await loadClientMatchesFromDb();
  expect(row).toMatchObject({ ID: 42, Game: "篮球", GameID: 10001, Matchs: { RAY: "basket1", Polymarket: "pmBasket" } });
  expect(row.Bets[0].Sources.RAY).toEqual(source);
});
