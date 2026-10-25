import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ write: vi.fn(), patch: vi.fn() }));
vi.mock("@changmen/db", () => ({ isMatcherStoreReady: () => true, writeClientMatchesAsync: mocks.write }));
vi.mock("@changmen/db/client_match_snapshot.js", () => ({ invalidateClientMatchSnapshot: vi.fn() }));
vi.mock("../../ray_match_risk.js", () => ({ filterRayRiskMatches: rows => rows }));
vi.mock("../../runtime_ports.js", () => ({
  publishCommittedClientMatches: vi.fn(), collectorRuntime: { patchCollectorMatchClientIds: mocks.patch },
}));
import { writeClientMatches } from "./write.js";
beforeEach(() => vi.clearAllMocks());

it("writes only lifecycle status for an existing ended match, preserving its full stored data", async () => {
  const original = { id: 42, title: "Original title", matchs: { OB: "ob1", RAY: "ray1", Polymarket: "pm1" },
    reverse: ["OB"], home_gb_team_id: 11, away_gb_team_id: 22, bets: [{ Map: 1 }] };
  const candidate = { ID: 42, Title: "Partial candidate", Matchs: { RAY: "ray1" }, Bets: [] };
  await writeClientMatches([], 5000, { endedRows: [candidate], existingClientRows: [original] });
  expect(mocks.write).toHaveBeenCalledExactlyOnceWith({ activeRows: [], endedRows: [], markEndedIds: [42], builtAt: 5000 });
  expect(original.matchs).toEqual({ OB: "ob1", RAY: "ray1", Polymarket: "pm1" });
  expect(mocks.patch.mock.calls[0][0][0].Matchs).toEqual(original.matchs);
});

it("keeps active writes and gap lifecycle updates in the same commit", async () => {
  await writeClientMatches([{ ID: 7, Matchs: { OB: "live", RAY: "live" } }], 6000,
    { markEndedIds: [42], existingClientRows: [{ id: 42, matchs: { OB: "old", RAY: "old" } }] });
  const payload = mocks.write.mock.calls[0][0];
  expect(payload.activeRows.map(row => row.id)).toEqual([7]);
  expect(payload.markEndedIds).toEqual([42]);
  expect(payload.endedRows).toEqual([]);
  expect(mocks.patch.mock.calls[0][0]).toContainEqual({ ID: 42, Matchs: { OB: "old", RAY: "old" } });
});

it("commits the final match directly to existing fields, retaining missing venue associations", async () => {
  const existing = { id: 7, matchs: { OB: "old", RAY: "live" } };
  const bets = [{ ID: 28672, Map: 0, Sources: { OB: { BetID: "old", Status: "Locked", HomeID: "", AwayID: "" } } }];
  await writeClientMatches([{ ID: 7, Matchs: { RAY: "live" }, Bets: bets, Reverse: ["OB"] }], 6000,
    { existingClientRows: [existing] });
  expect(mocks.write.mock.calls[0][0].activeRows[0].matchs).toEqual(existing.matchs);
  expect(mocks.write.mock.calls[0][0].activeRows[0].bets).toEqual(bets);
  expect(mocks.write.mock.calls[0][0].activeRows[0].reverse).toEqual(["OB"]);
});

it("does not publish or patch caches when the transaction fails", async () => {
  mocks.write.mockRejectedValueOnce(new Error("synthetic transaction failure"));
  await expect(writeClientMatches([{ ID: 7, Matchs: { OB: "old" } }], 6000))
    .rejects.toThrow("synthetic transaction failure");
  expect(mocks.patch).not.toHaveBeenCalled();
});
