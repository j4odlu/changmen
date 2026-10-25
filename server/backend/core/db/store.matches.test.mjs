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

it("delivers a basketball match with one venue and preserves its numeric game and native selection IDs", async () => {
  const source = { Type: "RAY", BetID: "1279801", HomeID: "h1", AwayID: "a1", HomeOdds: 1.8, AwayOdds: 2.1, Status: "Normal" };
  state.snapshot = { rows: [{ id: "42", title: "Melbourne United vs Sydney Kings", game: "篮球", game_id: "10001",
    start_time: Date.now(), matchs: { RAY: "basket1" }, reverse: [], bo: 0, round: 0,
    bets: [{ ID: 172032, Map: 0, Sources: { RAY: source } }], built_at: 1 }] };
  const [row] = await loadClientMatchesFromDb();
  expect(row).toMatchObject({ ID: 42, Game: "篮球", GameID: 10001, Matchs: { RAY: "basket1" } });
  expect(row.Bets[0].Sources.RAY).toEqual(source);
});
