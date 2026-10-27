import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadAndCreatePlugin } from "@changmen/team-resolver/team_db";

const db = vi.hoisted(() => ({
  fetchAllCanonicalTeams: vi.fn(), fetchAllTeamProviderIds: vi.fn(),
  fetchAllTeamPlatformMaps: vi.fn(), saveTeamMappingFireAndForget: vi.fn(), loadEnv: vi.fn(),
}));
vi.mock("@changmen/storage/load_env", () => ({ loadChangmenEnv: db.loadEnv }));
vi.mock("@changmen/db", () => db);

beforeEach(() => {
  for (const fn of Object.values(db)) fn.mockReset();
  db.fetchAllCanonicalTeams.mockResolvedValue([]);
  db.fetchAllTeamProviderIds.mockResolvedValue([]);
  db.fetchAllTeamPlatformMaps.mockResolvedValue([]);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("RDS team lookup plugin with offline ports", () => {
  it("isolates same-name teams by game, preserves string IDs and disables acronym guesses", async () => {
    db.fetchAllCanonicalTeams.mockResolvedValue([
      { id: 1, gb_team_id: 100001, game: "lol", name: "Shared", acronym: "SHR" },
      { id: "2", gb_team_id: "100002", game: "dota2", name: "Shared" },
      { id: 3, gb_team_id: null, game: "lol", name: "Unlinked" },
    ]);
    const p = await loadAndCreatePlugin();
    expect(p.lookupByName("lol", "shared")).toBe("1");
    expect(p.lookupByName("dota2", "shared")).toBe("2");
    expect(p.lookupByName("lol", "shr")).toBeNull();
    expect(p.lookupGbTeamIdByNormalizedNameForGame("lol", "shared")).toBe("100001");
    expect(p.lookupGbTeamIdByNormalizedNameForGame("dota2", "shared")).toBe("100002");
    expect(p.lookupGbTeamIdByNormalizedName("shared")).toBe("100001");
    expect(p.lookupByName("lol", "unlinked")).toBe("3");
    expect(p.lookupGbTeamIdByNormalizedName("unlinked")).toBeNull();
    expect(p.lookupGbTeamIdByNormalizedNameForGame("", "shared")).toBeNull();
  });
  it("prefers OB names and game hints while retaining platform ID scope", async () => {
    db.fetchAllCanonicalTeams.mockResolvedValue([{ id: 3, gb_team_id: 100003, game: "未知(7)", name: "Stored" }]);
    db.fetchAllTeamPlatformMaps.mockResolvedValue([
      { venue: "RAY", venue_team_id: "11", gb_team_id: 100003, venue_name: "Ray", game: "cs2" },
      { venue: "OB", venue_team_id: 11, gb_team_id: 100003, venue_name: "OB Name", game: "lol" },
      { venue: "OB", venue_team_id: 12, gb_team_id: 100003, venue_name: "Later Name", game: "lol" },
    ]);
    const p = await loadAndCreatePlugin();
    expect(p.lookupCanonicalName("100003")).toBe("OB Name");
    expect(p.lookupGameForGbTeamId("100003")).toBe("lol");
    expect(p.lookupGbTeamIdByNormalizedNameForGame("lol", "ob name")).toBe("100003");
    expect(p.lookupById("OB", "11")).toBe("100003");
    expect(p.lookupById("RAY", 11)).toBe("100003");
    expect(p.lookupById("PB", 11)).toBeNull();
    expect(p.lookupById("OB", 0)).toBeNull();
    expect(p.lookupCanonicalName("")).toBeNull();
  });
  it("retains stored names and unresolved games when rows have no game hint", async () => {
    db.fetchAllCanonicalTeams.mockResolvedValue([{ id: 1, gb_team_id: 100001, game: "unknown", name: "Stored" }]);
    db.fetchAllTeamPlatformMaps.mockResolvedValue([{ venue: "OB", venue_team_id: "1", gb_team_id: 100001, venue_name: " " }]);
    const p = await loadAndCreatePlugin();
    expect(p.lookupCanonicalName("100001")).toBe("Stored");
    expect(p.lookupGameForGbTeamId("100001")).toBe("unknown");
  });
  it("looks up provider IDs and tolerates unavailable provider metadata", async () => {
    db.fetchAllTeamProviderIds.mockResolvedValue([{ team_id: 1, provider: "pandascore", provider_id: "321" }]);
    const p = await loadAndCreatePlugin();
    expect(p.lookupProviderId("1", " pandascore ")).toBe("321");
    expect(p.lookupProviderId(1, "")).toBeNull();
    expect(p.lookupProviderId(2, "pandascore")).toBeNull();
    db.fetchAllTeamProviderIds.mockRejectedValue(new Error("synthetic metadata outage"));
    const degraded = await loadAndCreatePlugin();
    expect(degraded.lookupProviderId(1, "pandascore")).toBeNull();
    expect(console.warn).toHaveBeenCalledOnce();
  });
  it("publishes the mapping before fire-and-forget persistence and deduplicates saves", async () => {
    const p = await loadAndCreatePlugin();
    db.saveTeamMappingFireAndForget.mockImplementation(row => {
      expect(p.lookupById(row.platform, row.venue_team_id)).toBe("100001");
    });
    p.saveMapping("100001", "RAY", 12, "Team", "lol");
    expect(db.saveTeamMappingFireAndForget).toHaveBeenCalledWith({
      gb_team_id: 100001, platform: "RAY", venue_team_id: "12", venue_name: "Team",
      game: "lol", source: "auto", confidence: 1,
    });
    p.saveMapping(100002, "RAY", "12", "Other", "dota2");
    expect(db.saveTeamMappingFireAndForget).toHaveBeenCalledOnce();
    expect(p.lookupById("RAY", 12)).toBe("100001");
  });
  it("protects existing unresolved mappings and rejects invalid IDs", async () => {
    db.fetchAllTeamPlatformMaps.mockResolvedValue([{ venue: "OB", venue_team_id: "11", gb_team_id: null, venue_name: "New" }]);
    const p = await loadAndCreatePlugin();
    p.saveMapping(100001, "OB", "11", "Mapped", "lol");
    p.saveMapping(99999, "OB", "12", "Invalid");
    p.saveMapping("bad", "OB", "12", "Invalid");
    p.saveMapping(100001, "OB", "", "Invalid");
    expect(p.lookupById("OB", "11")).toBeNull();
    expect(db.saveTeamMappingFireAndForget).not.toHaveBeenCalled();
    p.saveMapping(100001, "OB", "12", null);
    expect(db.saveTeamMappingFireAndForget).toHaveBeenCalledWith(expect.objectContaining({ game: null, venue_name: "" }));
  });
});
