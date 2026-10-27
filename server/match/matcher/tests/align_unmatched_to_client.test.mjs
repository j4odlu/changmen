import { beforeEach, describe, expect, it } from "vitest";
import { normalizeMatchesShape } from "../compose/io/snapshot.js";
import {
  alignUnmatchedToClientMatches,
  MERGE_START_TIME_TOLERANCE_MS,
} from "../ops/align_unmatched_to_client.js";
import { setTeamPlugin } from "@changmen/match-identity/teams/team_key.js";

const START = 1_700_000_000_000;

const VALORANT_OB = "271192272576750";
const VALORANT_RAY = "37197927";

function rawMatches(rows) {
  const byPlatform = {};
  for (const r of rows) {
    if (!byPlatform[r.platform])
      byPlatform[r.platform] = [];
    byPlatform[r.platform].push({
      Type: r.platform,
      SourceMatchID: r.sourceMatchId,
      SourceGameID: r.sourceGameId ?? (r.platform === "RAY" ? VALORANT_RAY : VALORANT_OB),
      StartTime: r.startTime ?? START,
      Home: r.home,
      Away: r.away,
      HomeID: r.homeId,
      AwayID: r.awayId,
      BO: 3,
      ClientMatchId: r.clientMatchId ?? null,
    });
  }
  return normalizeMatchesShape(byPlatform);
}

describe("alignUnmatchedToClientMatches", () => {
  beforeEach(() => {
    setTeamPlugin({
      lookupById(platform, platformId) {
        const maps = {
          "OB:100217": "100217",
          "OB:100218": "100218",
          "RAY:200217": "100217",
          "RAY:200218": "100218",
        };
        return maps[`${platform}:${platformId}`] || null;
      },
    });
  });

  it("aligns late platform row to existing client_match by gb_team_id", () => {
    const matches = rawMatches([
      {
        platform: "OB",
        sourceMatchId: "ob1",
        home: "Leviatán GC",
        away: "Daruma Synergy",
        homeId: "100217",
        awayId: "100218",
      },
      {
        platform: "RAY",
        sourceMatchId: "ray1",
        home: "LEV.GC",
        away: "Daruma Synergy",
        homeId: "200217",
        awayId: "200218",
        clientMatchId: 302,
      },
    ]);

    const clientRows = [
      {
        id: 302,
        merge_key: "match:name:8:daruma synergy:leviatn gc",
        game_id: "8",
        start_time: START,
        matchs: { RAY: "ray1", IA: "ia1" },
      },
    ];

    const stats = alignUnmatchedToClientMatches(matches, clientRows);
    expect(stats.alignedById).toBe(1);
    expect(matches.OB.ob1.ClientMatchId).toBe(302);
  });

  it("aligns by normalized name and start time when ID maps are missing", () => {
    setTeamPlugin(null);

    const matches = rawMatches([
      {
        platform: "OB",
        sourceMatchId: "ob1",
        home: "Team Alpha",
        away: "Team Beta",
        homeId: "1",
        awayId: "2",
        startTime: START,
      },
    ]);

    const clientRows = [
      {
        id: 401,
        merge_key: "match:name:8:team alpha:team beta",
        game_id: "8",
        start_time: START + MERGE_START_TIME_TOLERANCE_MS - 60_000,
        matchs: { RAY: "ray1" },
      },
    ];

    const stats = alignUnmatchedToClientMatches(matches, clientRows);
    expect(stats.alignedByName).toBe(1);
    expect(matches.OB.ob1.ClientMatchId).toBe(401);
  });

  it("skips when client row already has another source for the platform", () => {
    const matches = rawMatches([
      {
        platform: "OB",
        sourceMatchId: "ob-new",
        home: "Leviatán GC",
        away: "Daruma Synergy",
        homeId: "100217",
        awayId: "100218",
      },
    ]);

    const clientRows = [
      {
        id: 302,
        merge_key: "match:id:8:100217:100218",
        game_id: "8",
        start_time: START,
        matchs: { OB: "ob-old" },
      },
    ];

    const stats = alignUnmatchedToClientMatches(matches, clientRows);
    expect(stats.alignedById).toBe(0);
    expect(matches.OB["ob-new"].ClientMatchId).toBeNull();
  });

  it("aligns late PB row by gb_team_id when raw HomeID lacks @gameSlug", () => {
    setTeamPlugin({
      lookupById(platform, platformId) {
        const maps = {
          "OB:navi-h": "100301",
          "OB:spirit-a": "100302",
          "PB:navi@cs2": "100301",
          "PB:spirit@cs2": "100302",
        };
        return maps[`${platform}:${platformId}`] || null;
      },
    });

    const CS2_OB = "257578064923863";
    const CS2_PB = "cs2";

    const matches = rawMatches([
      {
        platform: "OB",
        sourceMatchId: "ob1",
        sourceGameId: CS2_OB,
        home: "NAVI",
        away: "Spirit",
        homeId: "navi-h",
        awayId: "spirit-a",
        clientMatchId: 501,
      },
      {
        platform: "PB",
        sourceMatchId: "pb1",
        sourceGameId: CS2_PB,
        home: "Natus Vincere",
        away: "Team Spirit",
        homeId: "navi",
        awayId: "spirit",
      },
    ]);

    const clientRows = [
      {
        id: 501,
        merge_key: "match:name:3:natus vincere:team spirit",
        game_id: "3",
        start_time: START,
        matchs: { OB: "ob1" },
      },
    ];

    const stats = alignUnmatchedToClientMatches(matches, clientRows);
    expect(stats.alignedById).toBe(1);
    expect(matches.PB.pb1.ClientMatchId).toBe(501);
  });

  it("aligns late platform to hidden client row by gb_team_id", () => {
    setTeamPlugin({
      lookupById(platform, platformId) {
        const maps = {
          "OB:100217": "100217",
          "OB:100218": "100218",
          "RAY:200217": "100217",
          "RAY:200218": "100218",
        };
        return maps[`${platform}:${platformId}`] || null;
      },
    });

    const matches = rawMatches([
      {
        platform: "OB",
        sourceMatchId: "ob1",
        home: "Leviatán GC",
        away: "Daruma Synergy",
        homeId: "100217",
        awayId: "100218",
        clientMatchId: 777,
      },
      {
        platform: "RAY",
        sourceMatchId: "ray1",
        home: "LEV.GC",
        away: "Daruma Synergy",
        homeId: "200217",
        awayId: "200218",
      },
    ]);

    const clientRows = [
      {
        id: 777,
        merge_key: "match:name:8:daruma synergy:leviatn gc",
        game_id: "8",
        start_time: START,
        matchs: { OB: "ob1" },
      },
    ];

    const stats = alignUnmatchedToClientMatches(matches, clientRows);
    expect(stats.alignedById).toBe(1);
    expect(matches.RAY.ray1.ClientMatchId).toBe(777);
  });

  it("does not name-align when both teams have gb_team_id but no id client hit", () => {
    setTeamPlugin({
      lookupById(platform, platformId) {
        const maps = {
          "OB:100217": "100217",
          "OB:100218": "100218",
        };
        return maps[`${platform}:${platformId}`] || null;
      },
    });

    const matches = rawMatches([
      {
        platform: "OB",
        sourceMatchId: "ob1",
        home: "Leviatán GC",
        away: "Daruma Synergy",
        homeId: "100217",
        awayId: "100218",
      },
    ]);

    const clientRows = [
      {
        id: 888,
        merge_key: "match:name:8:daruma synergy:leviatn gc",
        game_id: "8",
        start_time: START,
        matchs: { RAY: "ray-other" },
      },
    ];

    const stats = alignUnmatchedToClientMatches(matches, clientRows);
    expect(stats.alignedById).toBe(0);
    expect(stats.alignedByName).toBe(0);
    expect(matches.OB.ob1.ClientMatchId).toBeNull();
  });

  it("id-align skips client row outside ±15min start window", () => {
    setTeamPlugin({
      lookupById(platform, platformId) {
        const maps = {
          "OB:100217": "100217",
          "OB:100218": "100218",
          "RAY:200217": "100217",
          "RAY:200218": "100218",
        };
        return maps[`${platform}:${platformId}`] || null;
      },
    });

    const matches = rawMatches([
      {
        platform: "RAY",
        sourceMatchId: "ray1",
        home: "LEV.GC",
        away: "Daruma Synergy",
        homeId: "200217",
        awayId: "200218",
        startTime: START + 2 * 60 * 60 * 1000,
      },
    ]);

    const clientRows = [
      {
        id: 901,
        merge_key: "match:id:8:100217:100218",
        game_id: "8",
        start_time: START,
        matchs: { OB: "ob1" },
      },
    ];

    const stats = alignUnmatchedToClientMatches(matches, clientRows);
    expect(stats.alignedById).toBe(0);
    expect(matches.RAY.ray1.ClientMatchId).toBeNull();
  });

  it("name-align skips when platform row has no start time", () => {
    setTeamPlugin(null);

    const matches = rawMatches([
      {
        platform: "OB",
        sourceMatchId: "ob1",
        home: "Team Alpha",
        away: "Team Beta",
        homeId: "1",
        awayId: "2",
        startTime: 0,
      },
    ]);

    const clientRows = [
      {
        id: 401,
        merge_key: "match:name:8:team alpha:team beta",
        game_id: "8",
        start_time: START,
        matchs: { RAY: "ray1" },
      },
    ];

    const stats = alignUnmatchedToClientMatches(matches, clientRows);
    expect(stats.alignedByName).toBe(0);
    expect(matches.OB.ob1.ClientMatchId).toBeNull();
  });

  it("does not align unmatched platforms onto ended client rows (M4)", () => {
    const matches = rawMatches([
      {
        platform: "OB",
        sourceMatchId: "ob1",
        home: "Leviatán GC",
        away: "Daruma Synergy",
        homeId: "100217",
        awayId: "100218",
      },
    ]);

    const clientRows = [
      {
        id: 1459,
        merge_key: "match:id:8:100217:100218",
        game_id: "8",
        start_time: START,
        matchs: { RAY: "ray1" },
        ended_at: START,
      },
    ];

    const stats = alignUnmatchedToClientMatches(matches, clientRows);
    expect(stats.alignedById).toBe(0);
    expect(matches.OB.ob1.ClientMatchId).toBeNull();
  });
});
