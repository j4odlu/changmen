import { describe, expect, test } from "vitest";
import {
  buildTfSaveBetRowsFromResults,
  compileTfBetNameRegex,
  extractMapTabsFromResults,
  listTfMarketFoEntries,
  marketLocked,
  selectionOddsId,
  stageFromTabName,
  tfMarketToSaveBetRow,
} from "./save_bets";

const BET_RE = compileTfBetNameRegex("(独赢)");

const MATCH_RESULTS = [
  {
    market_tabs: [{ tab_name: "MATCH" }, { tab_name: "MAP 1" }],
    markets: [
      {
        market_id: "m100",
        market_name: "独赢",
        map_num: 0,
        settlement_status: "open",
        selection: [
          { name: "home", euro_odds: 1.85, status: "open" },
          { name: "away", euro_odds: 2.05, status: "open" },
          { name: "draw", euro_odds: 3.5, status: "open" },
        ],
      },
    ],
  },
];

describe("tf save_bets", () => {
  test("selectionOddsId joins market and selection", () => {
    expect(selectionOddsId("m100", "home")).toBe("m100:home");
  });

  test("listTfMarketFoEntries includes all selections", () => {
    const market = MATCH_RESULTS[0].markets[0];
    const entries = listTfMarketFoEntries(market);
    expect(entries).toHaveLength(3);
    expect(entries[0].betId).toBe("m100");
  });

  test("tfMarketToSaveBetRow maps locked market", () => {
    const market = {
      ...MATCH_RESULTS[0].markets[0],
      selection: [
        { name: "home", euro_odds: 1.85, status: "closed" },
        { name: "away", euro_odds: 2.05, status: "open" },
      ],
    };
    expect(marketLocked(market, market.selection[0], market.selection[1])).toBe(true);
    const row = tfMarketToSaveBetRow("ev1", ["Alpha", "Beta"], market, 0);
    expect(row?.Status).toBe("Locked");
    expect(row?.BetName).toBe("[全场]-独赢");
  });

  test("buildTfSaveBetRowsFromResults dedupes by stage", () => {
    const rows = buildTfSaveBetRowsFromResults(
      MATCH_RESULTS,
      "ev1",
      ["Alpha", "Beta"],
      BET_RE,
      stageFromTabName("MATCH")!,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].Map).toBe(0);
    expect(rows[0].HomeOdds).toBe(1.85);
  });

  test("extractMapTabsFromResults skips MATCH tab", () => {
    expect(extractMapTabsFromResults(MATCH_RESULTS)).toEqual(["MAP 1"]);
  });

  test("stageFromTabName parses MAP tabs", () => {
    expect(stageFromTabName("MAP 2")).toEqual({
      stageId: 2,
      mapOption: "MAP 2",
      marketOption: "MAP",
    });
  });
});
