import type { ViewBet, ViewMatch } from "@/models/match";
import type { PmUpSignal } from "./upDetector";
import type { BrowserPmOddsDropSignal } from "./downSettings";
import { describe, expect, it } from "vitest";
import { buildOddsSignalBadges, SIGNAL_BADGE_TTL_MS } from "./oddsBadges";

const bet = {
  id: 101, homeName: "Alpha", awayName: "Beta", getBetName: () => "地图1",
  items: [
    { type: "Polymarket", homeId: "pm-a", awayId: "pm-b", getOdds: () => 2 },
    { type: "OB", homeId: "ob-a", awayId: "ob-b", getOdds: () => 2.2 },
    { type: "OB", homeId: "ob-other-a", awayId: "ob-other-b", getOdds: () => 9 },
    { type: "RAY", homeId: "ray-a", awayId: "ray-b", getOdds: () => 2.1 },
  ],
} as unknown as ViewBet;
const match = { id: 11, title: "Alpha vs Beta", bets: [bet] } as ViewMatch;
const up: PmUpSignal = {
  key: "11:101:Home:pm-a", id: "up", assetId: "pm-a", matchId: 11, betId: 101,
  matchTitle: match.title, marketTitle: "地图1", pmSide: "Home", pmSideLabel: "Alpha", targetSide: "Away", targetSideLabel: "Beta",
  beforeOdds: 1.8, pmOdds: 2.2, risePct: 22.222, baselineAt: 1000, detectedAt: 2000,
  target: { provider: "OB", itemId: "ob-b", odds: 2 }, arbPct: 4.7619,
};
const down: BrowserPmOddsDropSignal = {
  id: "down", assetId: "pm-a", referenceVenue: "Polymarket", sourceMode: "official",
  beforeBestAsk: 0.4, currentBestAsk: 0.5, beforeOdds: 2.5, currentOdds: 2,
  dropPct: 20, windowMs: 1000, baselineAt: 1000, detectedAt: 2000, selection: null,
  venueSnapshot: { matchId: 11, betId: 101, matchTitle: match.title, marketTitle: "地图1", side: "Home", sideLabel: "Alpha",
    referenceVenue: "Polymarket", pm: { odds: 2, evPercent: 0, itemId: "pm-a" },
    ob: { odds: 2.2, evPercent: 10, itemId: "ob-a" }, ray: { odds: 2.1, evPercent: 5, itemId: "ray-a" }, pb: null },
};
const display = { down: true, up: true };

describe("BetRow PM signal badge ownership", () => {
  it("puts PM movements on the source, price differences on the same side and arbitrage on the exact opposite option", () => {
    const rows = buildOddsSignalBadges(match, bet, [down], [up], 3000, display);
    expect(rows.get("Polymarket:Home:pm-a")?.map(row => row.label)).toEqual(["↓20.0%", "↑22.2%"]);
    expect(rows.get("Polymarket:Home:pm-a")?.map(row => row.movement)).toEqual([
      { beforeOdds: 2.5, currentOdds: 2 },
      { beforeOdds: 1.8, currentOdds: 2.2 },
    ]);
    expect(rows.get("OB:Home:ob-a")?.[0]?.movement).toBeUndefined();
    expect(rows.get("OB:Away:ob-b")?.[0]?.movement).toBeUndefined();
    expect(rows.get("OB:Home:ob-a")?.map(row => row.label)).toEqual(["高+10.0%"]);
    expect(rows.get("OB:Away:ob-b")?.map(row => row.label)).toEqual(["套+4.8%"]);
    expect(rows.get("RAY:Home:ray-a")?.map(row => row.label)).toEqual(["高+5.0%"]);
    expect(rows.get("OB:Home:ob-a")?.[0]?.title).toContain("OB 同侧赔率相对 PM 高 10.00%");
    expect(rows.has("OB:Home:ob-other-a")).toBe(false);
    expect(rows.has("RAY:Away:ray-b")).toBe(false);
  });

  it("maps an away PM rise to the home target without relying on visual row order", () => {
    const away = { ...up, assetId: "pm-b", pmSide: "Away", pmSideLabel: "Beta", targetSide: "Home", targetSideLabel: "Alpha", target: { ...up.target, itemId: "ob-a" } } as PmUpSignal;
    const rows = buildOddsSignalBadges(match, bet, [], [away], 3000, display);
    expect(rows.get("Polymarket:Away:pm-b")?.[0]?.role).toBe("source");
    expect(rows.get("OB:Home:ob-a")?.[0]?.role).toBe("arb");
    expect(rows.has("OB:Away:ob-b")).toBe(false);
  });

  it("uses the newest event per badge, respects display preferences and expires badges without deleting history", () => {
    const newest = { ...up, id: "new", detectedAt: 4000, risePct: 25 };
    const rows = buildOddsSignalBadges(match, bet, [down], [up, newest], 5000, { down: false, up: true });
    expect(rows.get("Polymarket:Home:pm-a")?.map(row => row.label)).toEqual(["↑25.0%"]);
    expect(rows.has("OB:Home:ob-a")).toBe(false);
    expect(buildOddsSignalBadges(match, bet, [down], [up], 2000 + SIGNAL_BADGE_TTL_MS, display).size).toBe(0);
    expect(down.venueSnapshot?.ob?.odds).toBe(2.2);
  });

  it("does not leak across matches or maps or guess the venue selection from a newer live price", () => {
    expect(buildOddsSignalBadges({ ...match, id: 12 } as ViewMatch, bet, [down], [up], 3000, display).size).toBe(0);
    expect(buildOddsSignalBadges(match, { ...bet, id: 102 } as ViewBet, [down], [up], 3000, display).size).toBe(0);
    const legacy = { ...down, venueSnapshot: { ...down.venueSnapshot!, ob: { odds: 2.2, evPercent: 10 }, ray: null } };
    const rows = buildOddsSignalBadges(match, bet, [legacy], [], 3000, display);
    expect(rows.size).toBe(1);
    expect(rows.has("Polymarket:Home:pm-a")).toBe(true);
  });

  it("skips currently suspended target options", () => {
    const locked = { ...bet, items: bet.items.map(item => item.type === "OB" ? { ...item, sourceStatus: "Suspended" } : item) } as unknown as ViewBet;
    const rows = buildOddsSignalBadges(match, locked, [down], [up], 3000, display);
    expect([...rows.keys()].some(key => key.startsWith("OB:"))).toBe(false);
  });

  it("hides both legs when the PM source option leaves the market or becomes suspended", () => {
    const missing = { ...bet, items: bet.items.filter(item => item.type !== "Polymarket") } as ViewBet;
    const locked = { ...bet, items: bet.items.map(item => item.type === "Polymarket" ? { ...item, sourceStatus: "Suspended" } : item) } as unknown as ViewBet;
    for (const current of [missing, locked]) expect(buildOddsSignalBadges(match, current, [down], [up], 3000, display).size).toBe(0);
  });
});
