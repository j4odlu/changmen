import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ lifecycle: vi.fn() }));
vi.mock("@changmen/db", () => ({
  initLastWrittenIds: vi.fn(), isMatcherStoreReady: () => true,
  fetchPlatformMatches: async () => ({}), fetchPlatformBets: async () => ({}), fetchLiveTimers: async () => ({}),
  fetchClientMatchesAll: mocks.lifecycle, fetchAllPlatformMatchBindings: async () => new Map(),
  fetchClientMatchPlatformOverrides: async () => ({}), fetchTeamMapsRevision: async () => "test",
}));
vi.mock("@changmen/team-resolver/team_db.js", () => ({ loadAndCreatePlugin: async () => ({}) }));
vi.mock("@changmen/match-identity/teams/team_key.js", () => ({ setTeamPlugin: vi.fn() }));
import { loadSnapshot, resetTeamPluginCache } from "./snapshot.js";
beforeEach(() => { vi.clearAllMocks(); resetTeamPluginCache(); });
it("does not compose from degraded identity rows when the lifecycle query failed", async () => {
  mocks.lifecycle.mockResolvedValue(null);
  await expect(loadSnapshot({ registerTeams: false })).rejects.toThrow("abort compose");
});
it("uses one full lifecycle read for identity, PM status and align", async () => {
  const rows = [{ id: "9", ended_at: "123", home_gb_team_id: "11", pm_sport: { ended: true } }];
  mocks.lifecycle.mockResolvedValue({ rows, version: "all-rows-v1" });
  const snapshot = await loadSnapshot({ registerTeams: false });
  expect(mocks.lifecycle).toHaveBeenCalledExactlyOnceWith({ snapshot: true });
  expect(snapshot.clientRows).toBe(rows); expect(snapshot.alignClientRows).toBe(rows);
  expect(snapshot.clientMatchSnapshotVersion).toBe("all-rows-v1");
});
