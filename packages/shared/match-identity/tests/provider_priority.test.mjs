import { describe, expect, it } from "vitest";
import { providerPriority, teamsFromPlatformRows } from "../teams/provider_priority.js";

describe("provider_priority", () => {
  it("ranks OB above PB and picks higher-priority team names", () => {
    expect(providerPriority("OB")).toBeGreaterThan(providerPriority("PB"));
    const picked = teamsFromPlatformRows([
      { platform: "PB", home: "PB Home", away: "PB Away" },
      { platform: "OB", home: "OB Home", away: "OB Away" },
    ]);
    expect(picked).toEqual({
      platform: "OB",
      home: "OB Home",
      away: "OB Away",
      title: "OB Home vs OB Away",
    });
  });

  it("uses canonical_teams names when both sides have gb_team_id mapping", () => {
    const resolvers = {
      lookupGbTeamId: (platform, platformId) => {
        if (platform === "OB" && platformId === "h1")
          return "100001";
        if (platform === "PB" && platformId === "a9")
          return "100002";
        return null;
      },
      lookupCanonicalName: (gbTeamId) => {
        if (gbTeamId === "100001")
          return "Canonical Home";
        if (gbTeamId === "100002")
          return "Canonical Away";
        return null;
      },
    };
    const picked = teamsFromPlatformRows(
      [
        { platform: "PB", home: "Team A", away: "Team B", homeId: "x", awayId: "a9" },
        { platform: "OB", home: "Team A", away: "Team B", homeId: "h1", awayId: "y" },
      ],
      resolvers,
    );
    expect(picked).toEqual({
      platform: "OB",
      home: "Canonical Home",
      away: "Canonical Away",
      title: "Canonical Home vs Canonical Away",
      canonical: true,
    });
  });

  it("falls back to platform priority when only one side is mapped", () => {
    const resolvers = {
      lookupGbTeamId: (platform, platformId) =>
        platform === "OB" && platformId === "h1" ? "100001" : null,
      lookupCanonicalName: gbTeamId => (gbTeamId === "100001" ? "Canonical Home" : null),
    };
    const picked = teamsFromPlatformRows(
      [
        { platform: "PB", home: "PB Home", away: "PB Away", homeId: "x", awayId: "y" },
        { platform: "OB", home: "OB Home", away: "OB Away", homeId: "h1", awayId: "z" },
      ],
      resolvers,
    );
    expect(picked?.title).toBe("OB Home vs OB Away");
    expect(picked?.canonical).toBeUndefined();
  });

  it("resolves canonical names when a platform has reversed home/away slots", () => {
    const resolvers = {
      lookupGbTeamId: (platform, platformId) => {
        const map = {
          "OB:158275076850578480": "100372",
          "OB:2063523233553981534": "100071",
          "TF:40143": "100071",
          "TF:39820": "100372",
        };
        return map[`${platform}:${platformId}`] || null;
      },
      lookupCanonicalName: (gbTeamId) => {
        if (gbTeamId === "100372")
          return "Passion Academy";
        if (gbTeamId === "100071")
          return "ex-MANA eSports";
        return null;
      },
    };
    const picked = teamsFromPlatformRows(
      [
        {
          platform: "OB",
          home: "Passion Academy",
          away: "ex-MANA eSports",
          homeId: "158275076850578480",
          awayId: "2063523233553981534",
        },
        {
          platform: "TF",
          home: "ex-MANA eSports",
          away: "Passion Academy",
          homeId: "40143",
          awayId: "39820",
        },
      ],
      resolvers,
    );
    expect(picked).toEqual({
      platform: "OB",
      home: "Passion Academy",
      away: "ex-MANA eSports",
      title: "Passion Academy vs ex-MANA eSports",
      canonical: true,
    });
  });
});
