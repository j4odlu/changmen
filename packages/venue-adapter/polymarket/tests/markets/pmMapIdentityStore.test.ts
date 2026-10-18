import { afterEach, expect, it } from "vitest";
import { lookupPmMapIdentityByToken, replacePmMapOutcomesFromIndex, lookupPmMapOutcomeByToken } from "../../pmMapOutcomeStore";

afterEach(() => replacePmMapOutcomesFromIndex(null));

it("keeps unsettled market identities separate from official results and replaces them with the index", () => {
  const entry = { sourceMatchId: "e", marketId: "m", sourceBetId: "m", map: 1,
    homeName: "Native Home", awayName: "Native Away", homeTokenId: "h", awayTokenId: "a",
    homeOdds: 1.1, awayOdds: 10, status: "Locked" };
  replacePmMapOutcomesFromIndex({ updatedAt: 1, assetIds: [], entries: [entry] });
  expect(lookupPmMapIdentityByToken("h")).toEqual(lookupPmMapIdentityByToken("a"));
  expect(lookupPmMapIdentityByToken("h")?.homeName).toBe("Native Home");
  expect(lookupPmMapOutcomeByToken("h")).toBeNull();
  replacePmMapOutcomesFromIndex({ updatedAt: 2, assetIds: [], entries: [], outcomeEntries: [{ ...entry, firstSeenAt: 1 }] });
  expect(lookupPmMapIdentityByToken("h")?.marketId).toBe("m");
  replacePmMapOutcomesFromIndex({ updatedAt: 3, assetIds: [], entries: [] });
  expect(lookupPmMapIdentityByToken("h")).toBeNull();
  replacePmMapOutcomesFromIndex({ updatedAt: 4, assetIds: [], entries: [entry] });
  replacePmMapOutcomesFromIndex(null);
  expect(lookupPmMapIdentityByToken("a")).toBeNull();
  expect(lookupPmMapIdentityByToken(undefined)).toBeNull();
});
