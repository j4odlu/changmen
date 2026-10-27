import assert from "node:assert/strict";
import { beforeEach, describe, it, vi } from "vitest";
import { betBucketKey, cloneRawSource, nativeSourcesByMap, rawSourceForMap, sourceFromBet } from "@changmen/matcher/compose/normalize/native_bets";

const storage = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@changmen/storage/predictfun_market_index", () => ({ readPredictFunMarketIndex: storage.read }));
let revision = 100;
beforeEach(() => storage.read.mockReset().mockReturnValue({ updatedAt: ++revision, entries: [] }));

const bet = (patch = {}) => ({
  Map: 0, SourceBetID: "b", SourceHomeID: "h", SourceAwayID: "a",
  HomeOdds: "1.2349", AwayOdds: "2.3459", Status: "Normal", ...patch,
});

describe("native source normalization", () => {
  it("rounds traditional odds and truncates prediction-market odds without changing raw rows", () => {
    const row = bet();
    const before = structuredClone(row);
    assert.equal(sourceFromBet("OB", row).HomeOdds, 1.235);
    assert.equal(sourceFromBet("Polymarket", row).HomeOdds, 1.234);
    assert.equal(sourceFromBet("PredictFun", { ...row, MarketID: "explicit" }).AwayOdds, 2.345);
    assert.equal(sourceFromBet("Other", bet({ HomeOdds: -1.2349 })).HomeOdds, -1.235);
    assert.equal(sourceFromBet("Polymarket", bet({ HomeOdds: -1.2349 })).HomeOdds, 0);
    for (const invalid of ["invalid", null, Infinity]) {
      assert.equal(sourceFromBet("OB", bet({ HomeOdds: invalid })).HomeOdds, 0);
    }
    assert.deepEqual(row, before);
  });

  it("preserves existing ID coercion, status defaults and positive line IDs", () => {
    const src = sourceFromBet("PB", bet({ SourceBetID: 0, SourceHomeID: 0, SourceAwayID: 7, Status: "", LineID: "12" }));
    assert.equal(src.BetID, "0");
    assert.equal(src.HomeID, "");
    assert.equal(src.AwayID, "7");
    assert.equal(src.Status, "Normal");
    assert.equal(src.LineID, 12);
    assert.equal(sourceFromBet("PB", {}).BetID, "undefined");
    assert.equal("LineID" in sourceFromBet("PB", bet({ LineID: -1 })), false);
    assert.equal(betBucketKey("PB", 0), "PB:0");
  });

  it("clones only the supported source fields and keeps raw odds unchanged", () => {
    const src = { Type: "OB", BetID: 12, HomeID: 0, AwayID: null, HomeOdds: "1.5", AwayOdds: 0, Status: "", HomeMarketID: 0, AwayMarketID: "m", LineID: "3", extra: true };
    const copy = cloneRawSource(src);
    assert.deepEqual(copy, { Type: "OB", BetID: "12", HomeID: "0", AwayID: "", HomeOdds: "1.5", AwayOdds: 0, Status: "Normal", AwayMarketID: "m", LineID: 3 });
    assert.notEqual(copy, src);
    assert.equal(src.Status, "");
    assert.equal(cloneRawSource(null), null);
    assert.equal(cloneRawSource(undefined), null);
    assert.equal(cloneRawSource({}).Type, undefined);
  });

  it("prefers OB odd-type main markets, keeps the first tie and rejects plus/handgun markets", () => {
    const rows = [
      bet({ SourceBetID: "legacy", BetName: "[全场]-获胜" }),
      bet({ SourceBetID: "typed", OddTypeID: "258531869137157", BetName: "typed label" }),
      bet({ SourceBetID: "tie", OddTypeID: "258531869137157", BetName: "same priority" }),
      bet({ SourceBetID: "plus", OddTypeID: "258531869137157", BetName: "[全场]+获胜" }),
      bet({ SourceBetID: "handgun", Map: 1, BetName: "[地图1]-手枪局获胜" }),
      bet({ SourceBetID: "map", Map: "1", OddTypeID: "258790779782319", BetName: "typed map" }),
      bet({ SourceBetID: "round", Map: 2, BetName: "[地图2]-第3回合获胜" }),
    ];
    const before = structuredClone(rows);
    const result = nativeSourcesByMap("OB", "m", { "OB:m": { bets: rows } }, "cs2");
    assert.deepEqual([...result].map(([map, src]) => [map, src.BetID]), [[0, "typed"], [1, "map"]]);
    assert.deepEqual(rows, before);
  });

  it("retains RAY catalog/legacy precedence and IA main-map filtering", () => {
    const ray = nativeSourcesByMap("RAY", "m", { "RAY:m": [
      bet({ SourceBetID: "16847", BetName: "catalog label" }),
      bet({ SourceBetID: "legacy", BetName: "[全场] 获胜者" }),
      bet({ SourceBetID: "16854", Map: 1, BetName: "catalog map" }),
      bet({ SourceBetID: "wrong", Map: 2, BetName: "handicap" }),
    ] }, "cs2");
    assert.deepEqual([...ray].map(([map, src]) => [map, src.BetID]), [[0, "legacy"], [1, "16854"]]);
    const ia = nativeSourcesByMap("IA", "m", { "IA:m": [
      bet({ Map: 1, BetName: "[地图1] 获胜者" }),
      bet({ Map: 2, BetName: "[地图2] 手枪局获胜者" }),
      bet({ Map: 3, BetName: "[地图3]+获胜者" }),
    ] });
    assert.deepEqual([...ia.keys()], [1]);
  });

  it("accepts array and wrapped buckets, converts map keys and clones selected results", () => {
    const rows = [bet({ SourceBetID: "first", Map: "invalid" }), bet({ SourceBetID: "tie" }), bet({ SourceBetID: "negative", Map: -1 })];
    for (const block of [rows, { bets: rows }]) {
      const buckets = { "PB:m": block };
      assert.deepEqual([...nativeSourcesByMap("PB", "m", buckets)].map(([m, src]) => [m, src.BetID]), [[0, "first"], [-1, "negative"]]);
      const a = rawSourceForMap("PB", "m", "invalid", buckets);
      const b = rawSourceForMap("PB", "m", 0, buckets);
      assert.deepEqual(a, b);
      assert.notEqual(a, b);
      assert.equal(rawSourceForMap("PB", "m", 4, buckets), null);
    }
    assert.equal(nativeSourcesByMap("OB", "m", null).size, 0);
    assert.equal(nativeSourcesByMap("OB", "m", {}).size, 0);
  });

  it("preserves provider fallback selection and excludes plus labels for all providers", () => {
    for (const platform of ["Polymarket", "PredictFun", "PB", "TF", "Other"]) {
      const result = nativeSourcesByMap(platform, "m", { [`${platform}:m`]: [
        bet({ SourceBetID: "main", MarketID: "m" }), bet({ Map: 1, BetName: "winner+extra" }),
      ] });
      assert.deepEqual([...result.keys()], [0]);
    }
    assert.equal(nativeSourcesByMap("Other", "m", { "Other:m": [{}] }).size, 0);
  });
});

describe("PredictFun token-to-market cache", () => {
  it("prefers explicit MarketID and falls back to home then away tokens", () => {
    assert.equal(sourceFromBet("PredictFun", bet({ MarketID: " explicit " })).HomeMarketID, "explicit");
    assert.equal(storage.read.mock.calls.length, 0);
    storage.read.mockReturnValue({ updatedAt: ++revision, entries: [{ homeTokenId: "h", awayTokenId: "a", homeMarketId: "home-market", awayMarketId: "away-market" }] });
    const home = sourceFromBet("PredictFun", bet());
    assert.equal(home.HomeMarketID, "home-market");
    assert.equal(home.AwayMarketID, "home-market");
    const away = sourceFromBet("PredictFun", bet({ SourceHomeID: "missing" }));
    assert.equal(away.HomeMarketID, "away-market");
    assert.equal(away.AwayMarketID, "away-market");
  });

  it("rebuilds only on updatedAt changes and clears stale tokens when the index disappears", () => {
    const stamp = ++revision;
    storage.read.mockReturnValue({ updatedAt: stamp, entries: [{ homeTokenId: "h", awayTokenId: "a", homeMarketId: "old" }] });
    assert.equal(sourceFromBet("PredictFun", bet({ SourceHomeID: "missing" })).HomeMarketID, "old");
    storage.read.mockReturnValue({ updatedAt: stamp, entries: [{ homeTokenId: "h", homeMarketId: "new" }] });
    assert.equal(sourceFromBet("PredictFun", bet()).HomeMarketID, "old");
    storage.read.mockReturnValue({ updatedAt: ++revision, entries: [{ homeTokenId: "h", homeMarketId: "new" }] });
    assert.equal(sourceFromBet("PredictFun", bet()).HomeMarketID, "new");
    storage.read.mockReturnValue(null);
    assert.equal("HomeMarketID" in sourceFromBet("PredictFun", bet()), false);
    assert.equal("AwayMarketID" in sourceFromBet("PredictFun", bet()), false);
  });
});
