import { afterEach, expect, it } from "vitest";
import * as source from "../index.ts";
import * as identity from "@changmen/match-identity";
import * as sourceKeys from "../teams/team_key.ts";
import * as publicKeys from "@changmen/match-identity/teams/team_key.js";

afterEach(() => identity.setTeamPlugin(null));
it("binds source and public exports to one domain implementation", () => {
  expect(Object.keys(source).sort()).toEqual(Object.keys(identity).sort());
  for (const name of Object.keys(identity)) expect(source[name]).toBe(identity[name]);
  for (const name of Object.keys(publicKeys)) expect(sourceKeys[name]).toBe(publicKeys[name]);
});
it("shares the injected team plugin across source and public import paths", () => {
  source.setTeamPlugin({ lookupById: (provider, id) => `${provider}:${id}` });
  expect(identity.lookupGbTeamIdByPlatform("OB", "42")).toBe("OB:42");
  publicKeys.setTeamPlugin(null);
  expect(sourceKeys.lookupGbTeamIdByPlatform("OB", "42")).toBeNull();
});
