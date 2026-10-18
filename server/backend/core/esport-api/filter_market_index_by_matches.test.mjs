import { describe, expect, it } from "vitest";
import {
  collectMatchedSourceIds,
  filterMarketIndexByClientMatches,
  matchedIdSetStamp,
  resolveFilteredIndexUpdatedAt,
} from "./filter_market_index_by_matches.js";

describe("filter_market_index_by_matches", () => {
  it("passes archived outcomes for matched IDs/slugs without subscribing them as quotes", () => {
    const index = { updatedAt: 1, entries: [], assetIds: [], outcomeEntries: [
      { sourceMatchId: "e1", marketId: "m1", homeTokenId: "h", awayTokenId: "a" },
      { sourceMatchId: "e2", eventSlug: "slug2", marketId: "m2" },
      { sourceMatchId: "other", marketId: "m3" },
    ] };
    const out = filterMarketIndexByClientMatches("Polymarket", index, [
      { Matchs: { Polymarket: "e1" } }, { Matchs: { Polymarket: "slug2" } },
    ]);
    expect(out.outcomeEntries.map(e => e.marketId)).toEqual(["m1", "m2"]);
    expect(out.entries).toEqual([]);
    expect(out.assetIds).toEqual([]);
    expect(filterMarketIndexByClientMatches("Polymarket", index, []).outcomeEntries).toEqual([]);
  });
  const pmIndex = {
    updatedAt: 1_700_000_000_000,
    assetIds: ["h1", "a1", "h2", "a2", "h3", "a3"],
    entries: [
      { sourceMatchId: "pm1", marketId: "m1", homeTokenId: "h1", awayTokenId: "a1", map: 0 },
      { sourceMatchId: "pm1", marketId: "m1b", homeTokenId: "h1b", awayTokenId: "a1b", map: 1, eventSlug: "slug-pm1" },
      { sourceMatchId: "pm2", marketId: "m2", homeTokenId: "h2", awayTokenId: "a2", map: 0 },
      { sourceMatchId: "pm3", marketId: "m3", homeTokenId: "h3", awayTokenId: "a3", map: 0 },
    ],
  };

  it("collectMatchedSourceIds reads Matchs[provider]", () => {
    const ids = collectMatchedSourceIds([
      { Matchs: { Polymarket: "pm1", OB: "ob1" }, built_at: 10 },
      { Matchs: { PredictFun: "pf1" }, built_at: 20 },
      { Matchs: { Polymarket: "" } },
    ], "Polymarket");
    expect([...ids]).toEqual(["pm1"]);
  });

  it("keeps all map entries for a matched sourceMatchId", () => {
    const out = filterMarketIndexByClientMatches("Polymarket", pmIndex, [
      { Matchs: { Polymarket: "pm1" }, built_at: 1_700_000_100_000 },
    ]);
    expect(out.entries.map(e => e.marketId).sort()).toEqual(["m1", "m1b"]);
    expect(out.assetIds.sort()).toEqual(["a1", "a1b", "h1", "h1b"]);
    expect(out.updatedAt).toBeGreaterThan(pmIndex.updatedAt);
  });

  it("matches eventSlug against Matchs id", () => {
    const out = filterMarketIndexByClientMatches("Polymarket", pmIndex, [
      { Matchs: { Polymarket: "slug-pm1" }, built_at: 1 },
    ]);
    expect(out.entries).toHaveLength(1);
    expect(out.entries[0].marketId).toBe("m1b");
  });

  it("empty matches yields empty entries but bumped updatedAt", () => {
    const out = filterMarketIndexByClientMatches("Polymarket", pmIndex, []);
    expect(out.entries).toEqual([]);
    expect(out.assetIds).toEqual([]);
    expect(out.updatedAt).not.toBe(pmIndex.updatedAt);
    expect(out.updatedAt).toBe(resolveFilteredIndexUpdatedAt(pmIndex.updatedAt, [], new Set()));
  });

  it("null index stays null", () => {
    expect(filterMarketIndexByClientMatches("Polymarket", null, [])).toBeNull();
  });

  it("PredictFun filters marketIds", () => {
    const pfIndex = {
      updatedAt: 100,
      marketIds: ["mh1", "ma1", "mh2", "ma2"],
      entries: [
        { sourceMatchId: "pf1", homeMarketId: "mh1", awayMarketId: "ma1" },
        { sourceMatchId: "pf2", homeMarketId: "mh2", awayMarketId: "ma2" },
      ],
    };
    const out = filterMarketIndexByClientMatches("PredictFun", pfIndex, [
      { Matchs: { PredictFun: "pf2" }, built_at: 200 },
    ]);
    expect(out.entries).toHaveLength(1);
    expect(out.marketIds.sort()).toEqual(["ma2", "mh2"]);
    expect(out.updatedAt).toBeGreaterThanOrEqual(200);
  });

  it("matchedIdSetStamp is stable and empty≠collide with zero", () => {
    expect(matchedIdSetStamp(["b", "a"])).toBe(matchedIdSetStamp(["a", "b"]));
    expect(matchedIdSetStamp([])).toBeGreaterThan(0);
    expect(matchedIdSetStamp(["x"])).not.toBe(matchedIdSetStamp(["y"]));
  });

  it("stamp survives Number precision at epoch scale", () => {
    const disk = 1_700_000_000_000;
    const a = resolveFilteredIndexUpdatedAt(disk, [], new Set());
    const b = resolveFilteredIndexUpdatedAt(disk, [], new Set(["pm1"]));
    expect(a).not.toBe(disk);
    expect(b).not.toBe(disk);
    expect(a).not.toBe(b);
    expect(Number.isInteger(a)).toBe(true);
    expect(JSON.parse(JSON.stringify({ a })).a).toBe(a);
  });

  it("same filter inputs yield same updatedAt", () => {
    const matches = [{ Matchs: { Polymarket: "pm2" }, built_at: 50 }];
    const a = filterMarketIndexByClientMatches("Polymarket", pmIndex, matches);
    const b = filterMarketIndexByClientMatches("Polymarket", pmIndex, matches);
    expect(a.updatedAt).toBe(b.updatedAt);
  });
});
