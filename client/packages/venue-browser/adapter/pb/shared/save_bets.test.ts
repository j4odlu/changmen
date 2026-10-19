import { describe, expect, test } from "vitest";
import { parseEuroOddsPayload } from "../parse";
import {
  buildPbSaveBetRowsFromMatch,
  listPbStageFoEntries,
  pbStageToSaveBetRow,
} from "./save_bets";

const FIXTURE = {
  leagues: [
    {
      id: 1,
      gameCode: "cs-go",
      gameName: "CS2",
      name: "Test League",
      events: [
        {
          id: 999001,
          time: 1_700_000_000_000,
          live: true,
          participants: [
            { type: "HOME", name: "Team A", englishName: "Team A" },
            { type: "AWAY", name: "Team B", englishName: "Team B" },
          ],
          periods: {
            "0": {
              moneyLine: {
                homePrice: 1.91,
                awayPrice: 1.95,
                lineId: 42,
              },
            },
            "1": {
              moneyLine: {
                homePrice: 2.1,
                awayPrice: 1.75,
                offline: true,
              },
            },
          },
        },
      ],
    },
  ],
};

describe("pb save_bets", () => {
  test("listPbStageFoEntries emits home/away fo rows", () => {
    const { matches } = parseEuroOddsPayload(FIXTURE, { allowedSlugs: ["cs-go"] });
    const stage = matches[0].stages[0];
    const entries = listPbStageFoEntries(stage);
    expect(entries).toHaveLength(2);
    expect(entries[0].betId).toBe("999001:0");
    expect(entries[0].odds).toBe(1.91);
    expect(entries[0].isLock).toBe(false);
  });

  test("pbStageToSaveBetRow maps locked stage", () => {
    const { matches } = parseEuroOddsPayload(FIXTURE, { allowedSlugs: ["cs-go"] });
    const match = matches[0];
    const map1 = match.stages.find((s) => s.stageId === 1)!;
    const row = pbStageToSaveBetRow(match, map1);
    expect(row.BetName).toBe("[地图1]-比赛胜负");
    expect(row.Status).toBe("Locked");
    expect(row.HomeOdds).toBe(2.1);
    expect(row.AwayOdds).toBe(1.75);
    expect(row.LineID).toBeUndefined();
  });

  test("pbStageToSaveBetRow includes LineID from moneyLine", () => {
    const { matches } = parseEuroOddsPayload(FIXTURE, { allowedSlugs: ["cs-go"] });
    const map0 = matches[0].stages.find((s) => s.stageId === 0)!;
    const row = pbStageToSaveBetRow(matches[0], map0);
    expect(row.LineID).toBe(42);
  });

  test("buildPbSaveBetRowsFromMatch returns one row per stage", () => {
    const { matches } = parseEuroOddsPayload(FIXTURE, { allowedSlugs: ["cs-go"] });
    const rows = buildPbSaveBetRowsFromMatch(matches[0]);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.Map).sort()).toEqual([0, 1]);
  });
});
