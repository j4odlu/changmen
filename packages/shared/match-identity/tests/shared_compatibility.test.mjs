import { afterEach, expect, it } from "vitest";
import * as legacy from "../index.js";
import * as shared from "@changmen/shared/match-identity";
import * as legacyKeys from "../teams/team_key.js";
import * as sharedKeys from "@changmen/shared/match-identity/teams/team_key.js";

afterEach(() => shared.setTeamPlugin(null));
it("keeps all legacy exports bound to one canonical shared implementation", () => {
  expect(Object.keys(legacy).sort()).toEqual(Object.keys(shared).sort());
  for (const name of Object.keys(shared)) expect(legacy[name]).toBe(shared[name]);
  for (const name of Object.keys(sharedKeys)) expect(legacyKeys[name]).toBe(sharedKeys[name]);
});
it("shares the injected team plugin across legacy and canonical import paths", () => {
  legacy.setTeamPlugin({ lookupById: (provider, id) => `${provider}:${id}` });
  expect(shared.lookupGbTeamIdByPlatform("OB", "42")).toBe("OB:42");
  sharedKeys.setTeamPlugin(null);
  expect(legacyKeys.lookupGbTeamIdByPlatform("OB", "42")).toBeNull();
});
