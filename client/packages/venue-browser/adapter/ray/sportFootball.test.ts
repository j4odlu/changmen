import { describe, expect, it } from "vitest";
import { rayFootballRowToClientMatchDto, RAY_FOOTBALL_GAME_ID } from "./sportFootball";

describe("RAY football DTO", () => {
  it("maps full-time and first-half standard markets", () => {
    const dto = rayFootballRowToClientMatchDto({
      id: 38443731,
      game_id: Number(RAY_FOOTBALL_GAME_ID),
      start_time: "2026-09-28 00:30:00",
      tournament_name: "西班牙乙级联赛",
      tournament_short_name: "Spain LaLiga 2",
      team: [
        { pos: 1, team_id: 11, team_name: "布尔戈斯", team_short_name: "Burgos" },
        { pos: 2, team_id: 22, team_name: "艾尔德斯", team_short_name: "Eldense" },
      ],
      odds: [
        { odds_group_id: 1, odds_id: "h", tag: "wdl", match_stage: "final", team_id: 11, odds: "1.80", status: 1 },
        { odds_group_id: 1, odds_id: "d", tag: "wdl", match_stage: "final", team_id: 0, value: "draw", name: "平", odds: "3.40", status: 1 },
        { odds_group_id: 1, odds_id: "a", tag: "wdl", match_stage: "final", team_id: 22, odds: "3.80", status: 1 },
        { odds_group_id: 2, odds_id: "sh", tag: "hdp", match_stage: "final", team_id: 11, value: "-0.5", odds: "1.98", status: 1 },
        { odds_group_id: 2, odds_id: "sa", tag: "hdp", match_stage: "final", team_id: 22, value: "+0.5", odds: "1.92", status: 1 },
        { odds_group_id: 3, odds_id: "o", tag: "ou", match_stage: "1st", value: ">1", odds: "2.12", status: 1 },
        { odds_group_id: 3, odds_id: "u", tag: "ou", match_stage: "1st", value: "<1", odds: "1.77", status: 1 },
      ],
    });

    expect(dto?.Title).toBe("Burgos vs Eldense");
    expect(dto?.League).toBe("Spain LaLiga 2");
    expect(dto?.Matchs).toEqual({ RAY: "38443731" });
    expect(dto?.Bets?.map(row => [row.MarketCode, row.Line])).toEqual([
      ["moneyline", null],
      ["spreads", -0.5],
      ["ht_totals", 1],
    ]);
    expect(dto?.Bets?.[0]?.Sources.RAY).toMatchObject({
      Type: "RAY",
      HomeID: "h",
      AwayID: "a",
      DrawID: "d",
      HomeOdds: 1.8,
      AwayOdds: 3.8,
      DrawOdds: 3.4,
      Status: "Normal",
    });
  });

  it("rejects football outrights with more than two teams", () => {
    expect(rayFootballRowToClientMatchDto({
      id: 1,
      game_id: Number(RAY_FOOTBALL_GAME_ID),
      team: [{ pos: 1 }, { pos: 2 }, { pos: 3 }],
    })).toBeNull();
  });
});
