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
