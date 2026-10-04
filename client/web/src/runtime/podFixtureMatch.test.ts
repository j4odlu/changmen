import { describe, expect, it } from "vitest";
import {
  fixtureFromViewMatch,
  formatPodFixtureMatch,
  matchPodAlertToFixtures,
  mergePodObDiscoveryFixtures,
  teamNameScore,
  type PodBoardFixture,
} from "@/runtime/podFixtureMatch";

const kick = 1_800_000_000_000;

function fixture(over: Partial<PodBoardFixture> = {}): PodBoardFixture {
  return {
    id: 1,
    title: "Arsenal vs Chelsea",
    game: "英超",
    startAt: kick,
    obMid: "5652292",
    homeName: "Arsenal",
    awayName: "Chelsea",
    markets: [],
    ...over,
  };
}

function alert(over: { home?: string; away?: string; starts?: number; league?: string } = {}) {
  return {
    home: "Arsenal",
    away: "Chelsea",
    starts: kick,
    league: "England - Premier League",
    ...over,
  };
}

describe("podFixtureMatch", () => {
  it("enriches an existing unnamed OB row from a search hit instead of discarding the duplicate mid", () => {
    const placeholder = fixture({ title: "英超 5652292", homeName: "", awayName: "" });
    const found = fixture({ id: 99, homeEn: "Arsenal", awayEn: "Chelsea" });
    const rows = mergePodObDiscoveryFixtures([placeholder], [found]);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(placeholder.id);
    expect(matchPodAlertToFixtures(alert(), rows)).toMatchObject({ status: "matched", basis: "confirmed" });
    expect(placeholder.homeEn).toBeUndefined();
  });
  it("scores latin names and ignores CJK-only or junk labels", () => {
    expect(teamNameScore("Arsenal", "Arsenal FC")).toBeGreaterThanOrEqual(0.5);
    expect(teamNameScore("Tottenham Hotspur", "Tottenham")).toBeGreaterThanOrEqual(0.5);
    expect(teamNameScore("Manchester United", "Newcastle United")).toBe(0);
    expect(teamNameScore("Man Utd", "Manchester United")).toBeGreaterThanOrEqual(0.99);
    expect(teamNameScore("Spurs", "Tottenham Hotspur")).toBeGreaterThanOrEqual(0.99);
    expect(teamNameScore("Arsenal", "阿森纳")).toBe(0);
    expect(teamNameScore("大", "小")).toBe(0);
  });

  it("matches a unique board fixture inside the kickoff window", () => {
    const row = matchPodAlertToFixtures(alert(), [
      fixture(),
      fixture({ id: 2, title: "Liverpool vs Everton", homeName: "Liverpool", awayName: "Everton", startAt: kick + 3_600_000, obMid: "" }),
    ]);
    expect(row.status).toBe("matched");
    expect(row.basis).toBe("confirmed");
    expect(row.hits[0]?.fixture.obMid).toBe("5652292");
    expect(formatPodFixtureMatch(row)).toMatch(/已确认/);
    expect(formatPodFixtureMatch(row)).toMatch(/OB/);
  });

  it("marks swapped home/away instead of dropping the fixture", () => {
    const row = matchPodAlertToFixtures(alert(), [
      fixture({ title: "Chelsea vs Arsenal", homeName: "Chelsea", awayName: "Arsenal" }),
    ]);
    expect(row.status).toBe("matched");
    expect(row.hits[0]?.swapped).toBe(true);
    expect(formatPodFixtureMatch(row)).toMatch(/主客相反/);
  });

  it("does not match outside the time window", () => {
    const row = matchPodAlertToFixtures(alert(), [
      fixture({ startAt: kick + 40 * 60 * 1000 }),
    ]);
    expect(row.status).toBe("none");
    expect(formatPodFixtureMatch(row)).toBe("未对上");
  });

  it("does not match English POD names to CJK-only board titles", () => {
    const row = matchPodAlertToFixtures(alert(), [
      fixture({ title: "阿森纳 vs 切尔西", homeName: "阿森纳", awayName: "切尔西", obMid: "cn-1" }),
    ]);
    expect(row.status).toBe("none");
  });

  it("keeps two latin hits as pending unless league unique-breaks them", () => {
    const a = fixture({ id: 1, game: "英超" });
    const b = fixture({ id: 2, title: "Arsenal vs Chelsea", game: "U21", obMid: "", startAt: kick + 60_000 });
    const pending = matchPodAlertToFixtures(alert({ league: "" }), [a, b]);
    expect(pending.status).toBe("pending");
    expect(formatPodFixtureMatch(pending)).toMatch(/待确认/);
    const unique = matchPodAlertToFixtures(alert(), [a, b]);
    expect(unique.status).toBe("matched");
    expect(unique.hits[0]?.fixture.game).toBe("英超");
  });

  it("reads team names from title and skips 大/小 bets", () => {
    const row = fixtureFromViewMatch({
      id: 9,
      title: "Neptunas Klaipeda vs Jonava",
      game: "Lithuania - 1 Lyga",
      startAt: kick,
      providers: { OB: "mid-9" },
      bets: [{ homeName: "大", awayName: "小" }],
    });
    expect(row.homeName).toBe("Neptunas Klaipeda");
    expect(row.awayName).toBe("Jonava");
    expect(row.obMid).toBe("mid-9");
    expect(row.markets).toEqual([{
      id: 0,
      marketCode: "",
      line: null,
      name: "",
      ob: false,
      quoteHome: 0,
      quoteAway: 0,
      quoteDraw: 0,
      oidHome: "",
      oidAway: "",
      oidDraw: "",
      betIdHome: "",
      betIdAway: "",
      betIdDraw: "",
    }]);
  });

  it("keeps totals lines from board bets for later market matching", () => {
    const row = fixtureFromViewMatch({
      id: 9,
      title: "Arsenal vs Chelsea",
      game: "英超",
      startAt: kick,
      providers: { OB: "5652292" },
      bets: [{
        id: 91,
        homeName: "大",
        awayName: "小",
        name: "全场大小 2.5",
        marketCode: "totals",
        line: 2.5,
        items: [{
          type: "OB",
          fallbackHomeOdds: 1.91,
          fallbackAwayOdds: 1.88,
          fallbackDrawOdds: 0,
          homeSubscribeId: "oid-h",
          awaySubscribeId: "oid-a",
          betId: "cond-91",
        }],
      }],
    });
    expect(row.markets).toEqual([{
      id: 91,
      marketCode: "totals",
      line: 2.5,
      name: "全场大小 2.5",
      ob: true,
      quoteHome: 1.91,
      quoteAway: 1.88,
      quoteDraw: 0,
      oidHome: "oid-h",
      oidAway: "oid-a",
      oidDraw: "",
      betIdHome: "cond-91",
      betIdAway: "cond-91",
      betIdDraw: "cond-91",
    }]);
  });

  it("matches English POD names via OB English sidecar, not the CJK title", () => {
    const row = matchPodAlertToFixtures(alert(), [
      fixture({
        title: "阿森纳 vs 切尔西",
        homeName: "阿森纳",
        awayName: "切尔西",
        homeEn: "Arsenal",
        awayEn: "Chelsea",
        gameEn: "England Premier League",
      }),
    ]);
    expect(row.status).toBe("matched");
    expect(row.basis).toBe("confirmed");
    expect(row.hits[0]?.fixture.title).toBe("阿森纳 vs 切尔西");
    expect(formatPodFixtureMatch(row)).toMatch(/已确认/);
  });

  it("keeps a unique weak-name hit as guess so auto will not take it", () => {
    const row = matchPodAlertToFixtures(alert(), [
      fixture({ obMid: "" }),
    ]);
    expect(row.status).toBe("matched");
    expect(row.basis).toBe("guess");
    expect(formatPodFixtureMatch(row)).toMatch(/猜测/);
  });
});
