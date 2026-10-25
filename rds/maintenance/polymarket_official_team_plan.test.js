import { describe, it, expect } from "vitest";
import { buildPolymarketOfficialTeamPlan } from "./polymarket_official_team_plan.js";

const map = (extra = {}) => ({ id: "1", venue_team_id: "cs2:alpha", venue_name: "Alpha",
  game: "cs2", gb_team_id: "100001", source: "manual", confidence: "1.00", ...extra });
const team = (extra = {}) => ({ id: 123, name: "Alpha", league: "csgo", providerId: 456, ...extra });
const plan = (maps, teams, evidence = []) => buildPolymarketOfficialTeamPlan({ maps, teams, evidence });

describe("one-time PM official team plan", () => {
  it("keeps the existing canonical binding while replacing the external ID", () => {
    const result = plan([map()], [team()]);
    expect(result.errors).toEqual([]);
    expect(result.entries[0]).toMatchObject({ oldId: "cs2:alpha", newId: "123", game: "cs2",
      expected: { gb_team_id: "100001", source: "manual", confidence: "1.00" } });
  });
  it("recognizes aliases and historical match-scoped IDs", () => {
    const result = plan([map({ venue_team_id: "777:home:A", venue_name: "A" })], [team({ alias: "A" })]);
    expect(result.entries[0].newId).toBe("123");
  });
  it("does not guess between duplicate names", () => {
    const result = plan([map()], [team(), team({ id: 124 })]);
    expect(result.entries).toEqual([]);
    expect(result.unresolved[0]).toMatchObject({ reason: "ambiguous", gbTeamId: "100001" });
  });
  it("uses the existing provider ID only to disambiguate duplicate names", () => {
    const result = plan([map({ pandascore_id: 789 })], [team(), team({ id: 124, providerId: 789 })]);
    expect(result.entries[0]).toMatchObject({ newId: "124", reason: "existing_provider_id" });
    expect(plan([map({ pandascore_id: 789 })], [team()]).entries[0].newId).toBe("123");
  });
  it("uses consistent event identities for a renamed team", () => {
    const evidence = [{ source: { home_id: "cs2:alpha", away_id: "cs2:beta" },
      event: { teams: [team({ name: "Renamed" }), team({ id: 200, name: "Beta" })] },
      resolvedTeams: [{ TeamID: "123" }, { TeamID: "200" }] }];
    const result = plan([map()], [team(), team({ id: 124 })], evidence);
    expect(result.entries[0]).toMatchObject({ newId: "123", name: "Renamed", reason: "event" });
  });
  it("rejects merging two different canonical teams into one official identity", () => {
    const result = plan([map(), map({ id: "2", venue_team_id: "old:alpha", gb_team_id: "100002" })], [team()]);
    expect(result.errors[0].reason).toBe("conflicting_canonical_ids");
  });
  it("coalesces aliases for the same canonical team", () => {
    const result = plan([map(), map({ id: "2", venue_team_id: "old:alpha" })], [team()]);
    expect(result.entries).toHaveLength(2);
    expect(result.errors).toEqual([]);
  });
  it("leaves unresolved pending history intact and skips existing official IDs", () => {
    const result = plan([map({ venue_team_id: "cs2:unknown", venue_name: "Unknown", gb_team_id: null }),
      map({ venue_team_id: "123" })], [team()]);
    expect(result.entries).toEqual([]);
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0].gbTeamId).toBeNull();
  });
});
