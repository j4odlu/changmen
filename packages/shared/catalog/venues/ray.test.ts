import type { RayOdd } from "./ray.ts";
import { describe, expect, it } from "vitest";
import legacyCatalog from "../market_catalog.json" with { type: "json" };
import { getPlatformRules, rayMatchesOddGroupId } from "../market_catalog.ts";
import { describeRayOdd, groupRayOdds, matchesRayLegacyWinner, parseRayValue, RAY_MARKET_CATALOG } from "./ray.ts";

const basketball = { eventId: "38461945", gameId: "1072082", gameCode: "basketball" };
function row(overrides: RayOdd = {}): RayOdd {
  return {
    odds_id: "1",
    odds_group_id: "1279840",
    match_stage: "final",
    tag: "hdp",
    value: "+1.5",
    status: 1,
    ...overrides,
  };
}

describe("rAY venue catalog migration", () => {
  it("carries every existing winner group without widening the collection policy", () => {
    const old = legacyCatalog.markets[0].platforms.RAY.gameOddGroups;
    const current = RAY_MARKET_CATALOG.legacySelection.winnerGroups;
    expect(Object.keys(current).sort()).toEqual(Object.keys(old).sort());
    for (const [gameCode, game] of Object.entries(old)) {
      const ids = [game.full, ...Object.values("map" in game ? game.map : {})];
      expect(current[gameCode].full).toBe(game.full);
      expect(current[gameCode].map).toEqual("map" in game ? game.map : {});
      for (const groupId of [...ids, "unknown"]) {
        const sample = { odds_group_id: groupId, group_name: "获胜者", status: 1 };
        expect(matchesRayLegacyWinner(sample, gameCode)).toBe(
          rayMatchesOddGroupId(sample, getPlatformRules("RAY"), gameCode),
        );
        expect(matchesRayLegacyWinner({ ...sample, status: 4 }, gameCode)).toBe(false);
      }
    }
    expect(matchesRayLegacyWinner({ group_name: "获胜者" }, "unknown")).toBe(true);
    expect(matchesRayLegacyWinner({ group_name: "一血" }, "unknown")).toBe(false);
    expect(matchesRayLegacyWinner({ group_name: " 获胜者 " })).toBe(false);
    expect(matchesRayLegacyWinner(row(), "basketball")).toBe(false);
    expect(matchesRayLegacyWinner(row({ odds_group_id: "2276305", tag: "win" }), "basketball")).toBe(false);
  });

  it("separates known semantics from tag shapes and mismatched identities", () => {
    const spread = describeRayOdd(row(), basketball);
    expect(spread.marketCode).toBe("handicap");
    expect(spread.definition).toMatchObject({ statistic: "points", overtime: "included", target: "match" });
    expect(describeRayOdd(row({ odds_group_id: "1280153", tag: "ou" }), basketball).marketCode).toBe("total");
    expect(describeRayOdd(row({ odds_group_id: "18478287", tag: "ou" }), basketball).definition)
      .toMatchObject({ marketCode: "team_total", target: "team1" });
    expect(describeRayOdd(row({ odds_group_id: "18478621", tag: "ou" }), basketball).definition)
      .toMatchObject({ marketCode: "team_total", target: "team2" });
    expect(describeRayOdd(row({ odds_group_id: "3304426", tag: "outright" }), basketball).definition)
      .toMatchObject({ marketCode: "outright", target: "tournament" });
    for (const overrides of [{ match_stage: "q2" }, { tag: "win" }, { odds_group_id: "new" }]) {
      expect(describeRayOdd(row(overrides), basketball).marketCode).toBeNull();
    }
    expect(describeRayOdd(row(), { ...basketball, gameId: "70" }).definition).toBeNull();
    expect(describeRayOdd(row(), { ...basketball, gameCode: "lol" }).definition).toBeNull();
    const firstBlood = describeRayOdd(row({ odds_group_id: "new", tag: "win", group_name: "一血" }), { eventId: "1", gameId: "70", gameCode: "lol" });
    expect(firstBlood.family).toBe("team_choice");
    expect(firstBlood.marketCode).toBeNull();
    const duration = describeRayOdd(row({ odds_group_id: "16790", match_stage: "r1", tag: "ou" }), { eventId: "2", gameId: "151", gameCode: "dota2" });
    expect(duration.family).toBe("over_under");
    expect(duration.marketCode).toBeNull();
  });

  it("preserves all signed handicap lines and original options without mutations", () => {
    const options = Array.from({ length: 23 }, (_, n) => n + 0.5).flatMap((n, i) => [
      row({ odds_id: `home-${i}`, value: `+${n}`, team_id: "home" }),
      row({ odds_id: `away-${i}`, value: `-${n}`, team_id: "away", status: 2 }),
    ]);
    const before = JSON.stringify(options);
    const result = groupRayOdds(options, basketball);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].options).toHaveLength(46);
    expect(new Set(result.groups[0].options.map(x => x.optionId)).size).toBe(46);
    expect(result.groups[0].options[0].value.components).toEqual([0.5]);
    expect(result.groups[0].options[1].value.components).toEqual([-0.5]);
    expect(JSON.stringify(options)).toBe(before);
    expect(result.groups[0].options[0].raw).toBe(options[0]);
  });

  it("keeps period, event and score contexts distinct and retains malformed rows", () => {
    const quarter = describeRayOdd(row({ match_stage: "q1" }), basketball);
    const half = describeRayOdd(row({ match_stage: "1st" }), basketball);
    expect(quarter.groupKey).not.toBe(half.groupKey);
    expect(quarter.stageLabel?.zh).toBe("第1节");
    expect(half.stageLabel?.zh).toBe("上半场");
    expect(describeRayOdd(row(), { ...basketball, eventId: "other" }).groupKey)
      .not
      .toBe(describeRayOdd(row(), basketball).groupKey);
    const rows = [
      row({ tag: "ahdp", value: "0-0,+0.25" }),
      row({ tag: "ahdp", value: "2-1,+0.25" }),
      row({ match_stage: "future", tag: "future", status: 4 }),
      row({ match_stage: "" }),
    ];
    const result = groupRayOdds(rows, basketball);
    expect(result.groups).toHaveLength(3);
    expect(result.ungrouped).toHaveLength(1);
    expect(result.groups[2].options[0]).toMatchObject({ stage: "future", stageLabel: null, family: null });
    expect(describeRayOdd(row({ match_stage: "__proto__", tag: "constructor" }), basketball))
      .toMatchObject({ stageLabel: null, family: null });
    expect(matchesRayLegacyWinner(row({ group_name: "一血" }), "__proto__")).toBe(false);
  });

  it("has unique semantic definitions and does not claim settlement verification", () => {
    const keys = RAY_MARKET_CATALOG.definitions.map(d => JSON.stringify([d.gameId, d.groupId, d.stage, d.tag]));
    expect(new Set(keys).size).toBe(keys.length);
    expect(RAY_MARKET_CATALOG.definitions.filter(d => d.gameCode === "basketball")).toHaveLength(22);
    expect(Object.keys(RAY_MARKET_CATALOG.protocol.stageLabels)).toHaveLength(61);
    expect(RAY_MARKET_CATALOG.integration).toBe("staged");
    expect(RAY_MARKET_CATALOG.settlement.verified).toBe(false);
  });
});

describe("rAY source line parsing", () => {
  it.each([
    ["hdp", "+1.5", "", "+1.5", [1.5], null],
    ["hdp", "-1.5", "", "-1.5", [-1.5], null],
    ["ahdp", "0-0,+0.25", "0-0", "+0.25", [0.25], null],
    ["ahdp", "2-1,-0.5,-1", "2-1", "-0.5,-1", [-0.5, -1], null],
    ["ahdp", "+1.5", "", "+1.5", [1.5], null],
    ["ou", ">225.5", "", "225.5", [225.5], "over"],
    ["ou", "< 2.5,3", "", "2.5,3", [2.5, 3], "under"],
    ["hdp", "0", "", "0", [0], null],
    ["hdp", "1.5oops", "", "1.5oops", null, null],
    ["hdp", "", "", "", null, null],
    ["hdp", "1,2,3", "", "1,2,3", null, null],
    ["ou", "225.5", "", null, null, null],
    ["unknown", "+1.5", "", null, null, null],
  ])("parses %s value %s without guessing", (tag, raw, score, line, components, direction) => {
    expect(parseRayValue(tag as string, raw)).toEqual({ raw, score, line, components, direction });
  });
});
