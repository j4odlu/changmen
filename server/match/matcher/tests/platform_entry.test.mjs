import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { setTeamPlugin } from "@changmen/match-identity/teams/team_key.js";
import { canUseIdKey, canUseNameKey, collectPlatformEntries, pairKeyId, pairKeyName } from "../compose/normalize/platform_entry.ts";

afterEach(() => setTeamPlugin(null));

describe("platform entry normalization", () => {
  it("converts raw fields and keeps the original snapshot object and metadata", () => {
    setTeamPlugin({ lookupById: (_p, id) => ({ 1: 100001, 2: "100002" })[id] });
    const row = {
      SourceMatchID: 123, SourceGameID: "257578064923863", HomeID: 1, AwayID: "2",
      Home: " Alpha Gaming ", Away: " Beta ", StartTime: "1800000000", BO: "3",
      RotNum: 0, ClientMatchId: "9", extra: { kept: true },
    };
    const before = structuredClone(row);
    const [entry] = collectPlatformEntries({ OB: { ignoredBucketKey: row } });
    assert.deepEqual(entry, {
      platform: "OB", sourceMatchId: "123", homeId: "1", awayId: "2",
      homeName: "Alpha Gaming", awayName: "Beta", homeGb: "100001", awayGb: "100002",
      homeN: "alpha", awayN: "beta", startMs: 1_800_000_000_000,
      gameCode: "cs2", Game: "CS:GO", GameID: "3", BO: 3, rotNum: "0",
      nativeRow: row, rowKey: "OB:123", clientMatchId: 9,
    });
    assert.equal(entry.nativeRow, row);
    assert.deepEqual(row, before);
    assert.equal(canUseIdKey(entry), true);
    assert.equal(pairKeyId(entry), "match:id:3:100001:100002");
    assert.equal(pairKeyName(entry), "match:name:3:alpha:beta");
  });

  it("uses existing ID/name aliases and scopes PB team slugs before lookup", () => {
    const lookups = [];
    setTeamPlugin({ lookupById: (p, id) => { lookups.push([p, id]); return id.startsWith("home") ? "100001" : "100002"; } });
    const [entry] = collectPlatformEntries({ PB: [{
      SourceMatchID: "pb", SourceGameID: "dota2", home_id: " home ", SourceAwayID: "dota-2:away",
      home: " Alpha ", away: " Beta ", rot_num: " 42 ", client_match_id: "7",
    }] });
    assert.equal(entry.homeId, "home@dota-2");
    assert.equal(entry.awayId, "away@dota-2");
    assert.equal(entry.gameCode, "dota2");
    assert.equal(entry.GameID, "2");
    assert.equal(entry.rotNum, "42");
    assert.equal(entry.clientMatchId, 7);
    assert.deepEqual(lookups, [["PB", "home@dota-2"], ["PB", "away@dota-2"]]);
  });

  it("preserves nullish alias precedence, unknown games and invalid linked IDs", () => {
    const [unknown, missing, fallback] = collectPlatformEntries({ OB: {
      unknown: { SourceMatchID: "u", SourceGameID: "unlisted", HomeID: "", home_id: "ignored", Home: "", home: "ignored", ClientMatchId: "bad", StartTime: "invalid" },
      missing: { SourceMatchID: "m", SourceGameID: null, GameID: undefined, match_id: "12" },
      fallback: { SourceMatchID: "f", SourceGameID: null, GameID: "257578064923863", HomeID: 0, home_id: "ignored", Home: "A", Away: "B" },
    } });
    assert.equal(unknown.gameCode, null);
    assert.equal(unknown.Game, "未知(unlisted)");
    assert.equal(unknown.GameID, "unlisted");
    assert.equal(unknown.homeId, "");
    assert.equal(unknown.homeName, "");
    assert(Number.isNaN(unknown.clientMatchId));
    assert.equal(unknown.startMs, 0);
    assert.equal(missing.Game, "未知(undefined)");
    assert.equal(missing.GameID, "");
    assert.equal(missing.clientMatchId, 12);
    assert.equal(fallback.homeId, "0");
    assert.equal(fallback.GameID, "3");
    assert.equal(fallback.clientMatchId, null);
  });

  it("skips unusable buckets and falsey source IDs without removing valid zero-like strings", () => {
    const rows = collectPlatformEntries({
      skipped: "not a bucket", empty: null, zero: 0,
      OB: { a: null, b: undefined, c: {}, d: { SourceMatchID: 0 }, e: { SourceMatchID: "" }, f: { SourceMatchID: "0" } },
    });
    assert.deepEqual(rows.map(r => r.rowKey), ["OB:0"]);
    assert.deepEqual(collectPlatformEntries(null), []);
    assert.deepEqual(collectPlatformEntries(undefined), []);
  });

  it("keeps ID and name eligibility distinct and retains fallback pair keys", () => {
    const entry = {
      platform: "OB", GameID: "3", gameCode: null, homeName: "Beta", awayName: "Alpha",
      homeId: "h", awayId: "a", homeGb: "100002", awayGb: "100001", homeN: "beta", awayN: "alpha",
    };
    assert.equal(canUseIdKey(entry), true);
    assert.equal(pairKeyId(entry), "match:id:3:100001:100002");
    assert.equal(canUseIdKey({ ...entry, awayGb: entry.homeGb }), false);
    assert.equal(canUseIdKey({ ...entry, homeGb: null }), false);
    assert.equal(canUseNameKey({ ...entry, homeGb: null }), true);
    assert.equal(canUseIdKey({ ...entry, homeN: "主队" }), false);
    assert.equal(canUseNameKey({ ...entry, awayN: "客队" }), false);
    assert.equal(pairKeyId({ ...entry, homeGb: null }), null);
    assert.equal(pairKeyName({ ...entry, homeName: "", awayName: "", GameID: "", gameCode: "cs2" }), "match:name:cs2:alpha:beta");
    assert.equal(pairKeyName({ ...entry, homeName: "", awayName: "", homeN: "" }), null);
  });
});
