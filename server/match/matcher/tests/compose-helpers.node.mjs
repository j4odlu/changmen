import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { swapBetSource } from "@changmen/matcher/compose/util/swap";
import { normalizeEpochMs as sharedNormalizeEpochMs } from "@changmen/shared/time/match_time";
import {
  normalizeEpochMs,
  startTimesCompatibleId,
  startTimesCompatibleName,
  NAME_START_TOLERANCE_MS,
  ID_START_TOLERANCE_MS,
} from "../compose/util/time.ts";
import { dedupeRowsById } from "../compose/ids/dedupe_rows.ts";

test("Node loads the typed helpers directly and exposes one swap implementation", () => {
  const require = createRequire(import.meta.url);
  assert.equal(require("@changmen/matcher/compose/util/swap").swapBetSource, swapBetSource);
  assert.throws(() => require("@changmen/matcher/compose/util/swap.js"), {
    code: "ERR_PACKAGE_PATH_NOT_EXPORTED",
  });
  for (const path of ["util/swap", "util/time", "ids/dedupe_rows"]) {
    assert.equal(existsSync(new URL(`../compose/${path}.js`, import.meta.url)), false);
    assert.equal(existsSync(new URL(`../compose/${path}.ts`, import.meta.url)), true);
  }
  assert.equal(normalizeEpochMs, sharedNormalizeEpochMs);
  assert.deepEqual(dedupeRowsById([{ ID: 1 }, { ID: "1" }]), {
    list: [{ ID: "1", Matchs: {} }], mergedCount: 1, conflicts: 0,
  });
});

test("time windows include their boundary in both directions and reject the next millisecond", () => {
  const start = 1_800_000_000_000;
  for (const [compatible, tolerance] of [
    [startTimesCompatibleId, ID_START_TOLERANCE_MS],
    [startTimesCompatibleName, NAME_START_TOLERANCE_MS],
  ]) {
    for (const sign of [-1, 1]) {
      assert.equal(compatible(start, start + sign * tolerance), true);
      assert.equal(compatible(start, start + sign * (tolerance + 1)), false);
    }
    assert.equal(compatible(String(start / 1000), start), true);
  }
  assert.equal(NAME_START_TOLERANCE_MS, 30 * 60_000);
  assert.equal(ID_START_TOLERANCE_MS, 60 * 60_000);
  assert.equal(startTimesCompatibleId(start, start + 45 * 60_000), true);
  assert.equal(startTimesCompatibleName(start, start + 45 * 60_000), false);
});

test("missing and invalid time allows ID matching but prevents name-only matching", () => {
  for (const missing of [null, undefined, "", 0, -1, "invalid", NaN, Infinity, {}]) {
    for (const [a, b] of [[missing, 1_800_000_000_000], [1_800_000_000_000, missing], [missing, missing]]) {
      assert.equal(startTimesCompatibleId(a, b), true);
      assert.equal(startTimesCompatibleName(a, b), false);
    }
  }
});

test("swapping copies side fields and keeps draw and provider metadata intact", () => {
  const src = {
    Type: "Polymarket", BetID: "bet", HomeID: "h", AwayID: 7,
    HomeOdds: 1.9, AwayOdds: 2.1, HomeMarketID: "mh", AwayMarketID: "ma",
    DrawID: "draw", DrawOdds: 3, LineID: 99, extra: { keep: true },
  };
  const before = structuredClone(src);
  const result = swapBetSource(src);
  assert.notEqual(result, src);
  assert.deepEqual(result, {
    ...src, HomeID: 7, AwayID: "h", HomeOdds: 2.1, AwayOdds: 1.9,
    HomeMarketID: "ma", AwayMarketID: "mh",
  });
  assert.equal(result.extra, src.extra);
  assert.deepEqual(src, before);
  assert.deepEqual(swapBetSource(result), src);
});

test("market IDs fall back only for nullish values, including a partial source", () => {
  for (const missing of [null, undefined]) {
    const one = swapBetSource({ HomeMarketID: "only", AwayMarketID: missing });
    assert.equal(one.HomeMarketID, "only");
    assert.equal(one.AwayMarketID, "only");
    const other = swapBetSource({ HomeMarketID: missing, AwayMarketID: "only" });
    assert.equal(other.HomeMarketID, "only");
    assert.equal(other.AwayMarketID, "only");
  }
  for (const present of [0, ""]) {
    assert.equal(swapBetSource({ HomeMarketID: "home", AwayMarketID: present }).HomeMarketID, present);
  }
  assert.deepEqual(swapBetSource({ HomeID: "only" }), {
    HomeID: undefined, AwayID: "only", HomeOdds: undefined, AwayOdds: undefined,
    HomeMarketID: undefined, AwayMarketID: undefined,
  });
});

test("non-object swap inputs are returned unchanged", () => {
  const fn = () => {};
  for (const input of [null, undefined, false, true, 0, NaN, "source", 5n, Symbol("source"), fn]) {
    assert.equal(swapBetSource(input), input);
  }
});
