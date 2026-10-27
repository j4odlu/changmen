import assert from "node:assert/strict";
import { it } from "vitest";
import { normalizeTeam } from "../teams/team_key.js";

it("normalizeTeam decodes &apos; and aliases Life's A Game → lag", () => {
  assert.equal(normalizeTeam("LAG Gaming"), "lag");
  assert.equal(normalizeTeam("Life's A Game"), "lag");
  assert.equal(normalizeTeam("Life&apos;s A Game"), "lag");
  assert.equal(normalizeTeam("LAG"), "lag");
  assert.equal(normalizeTeam("Overtake"), "overtake sector");
  assert.equal(normalizeTeam("Overtake Sector"), "overtake sector");
});

it("normalizeTeam aliases BetBoom / PARIVISION to OB title forms", () => {
  assert.equal(normalizeTeam("BetBoom Team"), normalizeTeam("BB Team"));
  assert.equal(normalizeTeam("PARIVISION"), normalizeTeam("TEAM VISION"));
  assert.equal(normalizeTeam("Parivision"), normalizeTeam("TEAM VISION"));
  assert.equal(normalizeTeam("PVISION"), normalizeTeam("TEAM VISION"));
});
