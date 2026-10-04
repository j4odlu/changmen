import { describe, expect, it } from "vitest";
import { describePodAlertMatch, shouldDiscoverPodObAlert } from "./podAlertMatchStatus";
import { POD_BET_SETTINGS_DEFAULTS } from "./podBetSettings";
import { buildPodBetTicket } from "./podBetTicket";
import { matchPodAlertAcrossVenuePlugins } from "./podVenueMatchPlugins";
import type { PodDropAlert } from "./podAlerts";
import type { PodBoardFixture } from "./podFixtureMatch";

const now = 1_791_107_700_000;
const alert: PodDropAlert = { id: "sample", eventId: "p1", sport: "Football", sportId: 1,
  league: "Norway - 3rd Division", home: "Stabaek II", away: "Haugesund II", starts: 1_791_111_600_000,
  alertedAt: now, market: "Handicap", lineType: "spreads", period: 0, outcome: "home", points: -1.25,
  previous: 2.31, current: 1.751, nvp: 0, dropPct: 24.2, ways: 2 };
const fixture: PodBoardFixture = { id: 1, title: "Stabaek B vs FK Haugesund B", game: "Norway Division 3",
  startAt: alert.starts, obMid: "5726365", homeName: "Stabaek B", awayName: "FK Haugesund B",
  markets: [{ id: 1, marketCode: "spreads", name: "让球", line: -1, ob: true, quoteHome: 1.85,
    quoteAway: 1.85, quoteDraw: 0, oidHome: "h", oidAway: "a" }] };
const live = { get: () => 0, has: () => false };

describe("POD matching facts versus follow settings", () => {
  it("finds the reported reserve-team fixture but distinguishes the unavailable target handicap", () => {
    const results = matchPodAlertAcrossVenuePlugins(alert, [fixture], live);
    expect(results.get("OB")?.fixture).toMatchObject({ status: "matched", basis: "confirmed" });
    expect(results.get("OB")?.market.status).toBe("none");
    expect(describePodAlertMatch(alert, results.values(), POD_BET_SETTINGS_DEFAULTS, now))
      .toMatchObject({ matched: false, label: "OB 已找到比赛 · 盘口未对上", gateLabel: "让球跟单未启用" });
    expect(buildPodBetTicket(alert, POD_BET_SETTINGS_DEFAULTS, now)).toBeNull();
  });

  it("shows successful matching even if follow settings exclude that market", () => {
    const target = { ...fixture, markets: fixture.markets.map(row => ({ ...row, line: -1.25 })) };
    const results = matchPodAlertAcrossVenuePlugins(alert, [target], live);
    expect(describePodAlertMatch(alert, results.values(), POD_BET_SETTINGS_DEFAULTS, now))
      .toMatchObject({ matched: true, label: "OB 已匹配", gateLabel: "让球跟单未启用" });
    expect(buildPodBetTicket(alert, POD_BET_SETTINGS_DEFAULTS, now)).toBeNull();
  });

  it("allows recent prematch discovery with automatic betting off and excludes stale/live/other sports", () => {
    expect(POD_BET_SETTINGS_DEFAULTS.autoPlace).toBe(false);
    expect(shouldDiscoverPodObAlert(alert, now)).toBe(true);
    expect(shouldDiscoverPodObAlert({ ...alert, alertedAt: now - 61_000 }, now)).toBe(false);
    expect(shouldDiscoverPodObAlert({ ...alert, starts: now - 1 }, now)).toBe(false);
    expect(shouldDiscoverPodObAlert({ ...alert, sport: "Basketball", sportId: 2 }, now)).toBe(false);
  });
});
