import { describe, expect, test } from "vitest";
import {
  buildObSaveBetRowsFromViewBlocks,
  compileObBetNameRe,
  isObBlockCollectable,
} from "./save_bets";

const BET_RE = compileObBetNameRe(
  "(\\[全场\\].+获胜)|(\\[地图\\d+\\].+获胜)|(.+全局.+获胜)|(.+单局.+获胜)",
);
const TEAMS: [string, string] = ["Marsborne", "F5 Esports"];
const CS2_MAP_ODD_TYPE = "258790779782319";
const CS2_FULL_ODD_TYPE = "258531869137157";

function obBlock(partial: Record<string, unknown>): Record<string, unknown> {
  return {
    status: 6,
    visible: 1,
    suspended: 0,
    ...partial,
  };
}

describe("buildObSaveBetRowsFromViewBlocks", () => {
  test("CS2 Map1 with odd_type_id: map winner included, pistol rejected by id", () => {
    const blocks = [
      obBlock({
        id: "5561517900269057",
        round: 1,
        odd_type_id: CS2_FULL_ODD_TYPE,
        cn_name: "第一手枪局获胜",
        odds: {
          h: { id: "5561517900269600", name: "@T1", odd: 1.649 },
          a: { id: "5561517900269601", name: "@T2", odd: 2.186 },
        },
      }),
      obBlock({
        id: "5561517888837431",
        round: 1,
        odd_type_id: CS2_MAP_ODD_TYPE,
        cn_name: "单局-获胜",
        odds: {
          h: { id: "5561517888838120", name: "@T1", odd: 1.2 },
          a: { id: "5561517888838121", name: "@T2", odd: 4.338 },
        },
      }),
    ];

    const rows = buildObSaveBetRowsFromViewBlocks(blocks, "4272745136855916", TEAMS, BET_RE, "cs2");
    expect(rows).toHaveLength(1);
    expect(rows[0].BetName).toBe("[地图1]-单局-获胜");
    expect(rows[0].SourceBetID).toBe("5561517888837431");
    expect(rows[0].HomeOdds).toBe(1.2);
    expect(rows[0].AwayOdds).toBe(4.338);
  });

  test("CS2 Map1 without gameCode: legacy betName still excludes pistol round", () => {
    const blocks = [
      obBlock({
        id: "5561517900269057",
        round: 1,
        cn_name: "第一手枪局获胜",
        odds: {
          h: { id: "h1", name: "@T1", odd: 1.649 },
          a: { id: "a1", name: "@T2", odd: 2.186 },
        },
      }),
      obBlock({
        id: "5561517888837431",
        round: 1,
        cn_name: "单局-获胜",
        odds: {
          h: { id: "h2", name: "@T1", odd: 1.2 },
          a: { id: "a2", name: "@T2", odd: 4.338 },
        },
      }),
    ];

    const rows = buildObSaveBetRowsFromViewBlocks(blocks, "4272745136855916", TEAMS, BET_RE);
    expect(rows).toHaveLength(1);
    expect(rows[0].SourceBetID).toBe("5561517888837431");
  });

  test("odd_type_id match skips betName filter", () => {
    const block = obBlock({
      id: "map-win",
      round: 1,
      odd_type_id: CS2_MAP_ODD_TYPE,
      cn_name: "第一手枪局获胜",
      odds: {
        h: { id: "h", name: "@T1", odd: 1.5 },
        a: { id: "a", name: "@T2", odd: 2.5 },
      },
    });
    expect(isObBlockCollectable(block, "[地图1]-第一手枪局获胜", BET_RE, "cs2")).toBe(true);
    expect(
      buildObSaveBetRowsFromViewBlocks([block], "m1", TEAMS, BET_RE, "cs2"),
    ).toHaveLength(1);
  });

  test("hidden or settled blocks are skipped", () => {
    const block = obBlock({
      id: "1",
      round: 0,
      odd_type_id: CS2_FULL_ODD_TYPE,
      cn_name: "全局-获胜",
      visible: 0,
      odds: {
        h: { id: "h", name: "@T1", odd: 1.9 },
        a: { id: "a", name: "@T2", odd: 1.8 },
      },
    });
    expect(isObBlockCollectable(block, "[全场]-全局-获胜", BET_RE, "cs2")).toBe(false);
    expect(buildObSaveBetRowsFromViewBlocks([block], "m1", TEAMS, BET_RE, "cs2")).toEqual([]);
  });
});
