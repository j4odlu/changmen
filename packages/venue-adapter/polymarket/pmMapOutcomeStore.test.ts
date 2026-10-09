import { describe, expect, it } from "vitest";

import {
  lookupPmMapOutcomeByToken,
  lookupResolutionSourceBySourceMatchId,
  pmMapOutcomeWinnerLabel,
  replacePmMapOutcomesFromIndex,
} from "./pmMapOutcomeStore";

describe("pmMapOutcomeStore", () => {
  it("indexes outcomes by home/away token and clears on null", () => {
    replacePmMapOutcomesFromIndex({
      updatedAt: 1,
      assetIds: ["h", "a"],
      entries: [{
        sourceMatchId: "e1",
        marketId: "c1",
        homeTokenId: "h",
        awayTokenId: "a",
        sourceBetId: "c1",
        map: 3,
        homeName: "Heroic",
        awayName: "K27",
        homeOdds: 1.01,
        awayOdds: 50,
        status: "Normal",
        mapOutcome: "home",
        outcomeKind: "official",
        resolutionSource: "https://www.twitch.tv/valorantesports_cn",
      }],
    });
    const hit = lookupPmMapOutcomeByToken("a");
    expect(hit?.mapOutcome).toBe("home");
    expect(pmMapOutcomeWinnerLabel(hit!, "Heroic", "K27")).toBe("Heroic");
    expect(lookupResolutionSourceBySourceMatchId("e1")).toBe(
      "https://www.twitch.tv/valorantesports_cn",
    );

    replacePmMapOutcomesFromIndex(null);
    expect(lookupPmMapOutcomeByToken("h")).toBeNull();
    expect(lookupResolutionSourceBySourceMatchId("e1")).toBeNull();
  });

  it.each([0, 1, 3])("requires an official winner for map %s and clears obsolete price outcomes", (map) => {
    for (const outcomeKind of ["price", undefined] as const) {
      replacePmMapOutcomesFromIndex({
        updatedAt: 1,
        assetIds: ["h0", "a0"],
        entries: [{
          sourceMatchId: "e1",
          marketId: "c0",
          homeTokenId: "h0",
          awayTokenId: "a0",
          sourceBetId: "c0",
          map,
          homeName: "T1",
          awayName: "GEN",
          homeOdds: 1.01,
          awayOdds: 50,
          status: "Normal",
          mapOutcome: "away",
          outcomeKind,
        }],
      });
      expect(lookupPmMapOutcomeByToken("h0")).toBeNull();
      expect(lookupPmMapOutcomeByToken("a0")).toBeNull();
    }
    replacePmMapOutcomesFromIndex({
      updatedAt: 2,
      assetIds: ["h0", "a0"],
      entries: [{
        sourceMatchId: "e1",
        marketId: "c0",
        sourceBetId: "c0",
        homeTokenId: "h0",
        awayTokenId: "a0",
        map,
        homeName: "T1",
        awayName: "GEN",
        homeOdds: 1.01,
        awayOdds: 50,
        status: "Normal",
        mapOutcome: "away",
        outcomeKind: "official",
      }],
    });
    const hit = lookupPmMapOutcomeByToken("h0");
    expect(hit?.map).toBe(map);
    expect(hit?.mapOutcome).toBe("away");
    expect(pmMapOutcomeWinnerLabel(hit!, "T1", "GEN")).toBe("GEN");
    replacePmMapOutcomesFromIndex({ updatedAt: 3, assetIds: ["h0", "a0"], entries: [{
      sourceMatchId: "e1",
      marketId: "c0",
      sourceBetId: "c0",
      homeTokenId: "h0",
      awayTokenId: "a0",
      map,
      homeName: "T1",
      awayName: "GEN",
      homeOdds: 1.01,
      awayOdds: 50,
      status: "Normal",
      mapOutcome: "away",
      outcomeKind: "price",
    }] });
    expect(lookupPmMapOutcomeByToken("h0")).toBeNull();
    expect(lookupPmMapOutcomeByToken("a0")).toBeNull();
  });

  it("keeps first resolutionSource per sourceMatchId across map entries", () => {
    replacePmMapOutcomesFromIndex({
      updatedAt: 1,
      assetIds: [],
      entries: [
        {
          sourceMatchId: "e1",
          marketId: "c0",
          homeTokenId: "h0",
          awayTokenId: "a0",
          sourceBetId: "c0",
          map: 0,
          homeName: "A",
          awayName: "B",
          homeOdds: 2,
          awayOdds: 2,
          status: "Normal",
          resolutionSource: "https://kick.com/cct_cs",
        },
        {
          sourceMatchId: "e1",
          marketId: "c1",
          homeTokenId: "h1",
          awayTokenId: "a1",
          sourceBetId: "c1",
          map: 1,
          homeName: "A",
          awayName: "B",
          homeOdds: 2,
          awayOdds: 2,
          status: "Normal",
          resolutionSource: "https://example.com/other",
        },
      ],
    });
    expect(lookupResolutionSourceBySourceMatchId("e1")).toBe("https://kick.com/cct_cs");
  });

  it("indexes resolutionSource under eventSlug alias", () => {
    replacePmMapOutcomesFromIndex({
      updatedAt: 1,
      assetIds: [],
      entries: [{
        sourceMatchId: "12345",
        eventSlug: "lol-t1-gen-2026-01-01",
        marketId: "c0",
        homeTokenId: "h0",
        awayTokenId: "a0",
        sourceBetId: "c0",
        map: 0,
        homeName: "T1",
        awayName: "GEN",
        homeOdds: 2,
        awayOdds: 2,
        status: "Normal",
        resolutionSource: "https://www.twitch.tv/valorantesports_cn",
      }],
    });
    expect(lookupResolutionSourceBySourceMatchId("12345")).toBe(
      "https://www.twitch.tv/valorantesports_cn",
    );
    expect(lookupResolutionSourceBySourceMatchId("lol-t1-gen-2026-01-01")).toBe(
      "https://www.twitch.tv/valorantesports_cn",
    );
  });

  it("sticks resolutionSource after match leaves Index", () => {
    replacePmMapOutcomesFromIndex({
      updatedAt: 1,
      assetIds: ["h", "a"],
      entries: [{
        sourceMatchId: "e1",
        marketId: "c1",
        homeTokenId: "h",
        awayTokenId: "a",
        sourceBetId: "c1",
        map: 1,
        homeName: "A",
        awayName: "B",
        homeOdds: 2,
        awayOdds: 2,
        status: "Normal",
        resolutionSource: "https://www.twitch.tv/valorantesports_cn",
      }],
    });
    replacePmMapOutcomesFromIndex({
      updatedAt: 2,
      assetIds: [],
      entries: [],
    });
    expect(lookupResolutionSourceBySourceMatchId("e1")).toBe(
      "https://www.twitch.tv/valorantesports_cn",
    );
    expect(lookupPmMapOutcomeByToken("h")).toBeNull();
  });
});
