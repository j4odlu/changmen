import type { BrowserPmOddsDropSignal } from "./downSettings";
import type { PmOddsDropVenueSnapshot } from "./downVenueSnapshot";
import type { ViewBet, ViewMatch } from "@/models/match";
import { describe, expect, it } from "vitest";
import { betOddsDropSignals, matchOddsDropSignals } from "./downMatchSignals";

const match = {
  id: 11,
  title: "Alpha vs Beta",
  bets: [{
    id: 101,
    getBetName: () => "地图1 获胜",
    homeName: "Alpha",
    awayName: "Beta",
    items: [{ type: "Polymarket", homeId: "home-token", awayId: "away-token", getOdds: () => 2 }],
  }],
} as unknown as ViewMatch;

function signal(patch: Partial<BrowserPmOddsDropSignal> = {}): BrowserPmOddsDropSignal {
  return {
    id: "signal-1", assetId: "home-token", referenceVenue: "Polymarket", sourceMode: "official",
    beforeBestAsk: 0.4, currentBestAsk: 0.5, beforeOdds: 2.5, currentOdds: 2,
    dropPct: 20, windowMs: 1000, baselineAt: 1000, detectedAt: 2000,
    selection: null, venueSnapshot: null, ...patch,
  };
}

describe("match card odds drop signals", () => {
  it("associates PM tokens with the correct match and canonical direction", () => {
    const rows = matchOddsDropSignals(match, [signal(), signal({ id: "away", assetId: "away-token" }), signal({ assetId: "other-token" })]);
    expect(rows.map(row => row.snapshot.sideLabel)).toEqual(["Alpha", "Beta"]);
    expect(matchOddsDropSignals({ ...match, id: 22, bets: [] } as unknown as ViewMatch, [signal()])).toEqual([]);
  });

  it("retains the latest signal for each venue/token in descending time order", () => {
    const rows = matchOddsDropSignals(match, [
      signal(),
      signal({ id: "newest", detectedAt: 4000 }),
      signal({ id: "away", assetId: "away-token", detectedAt: 3000 }),
      signal({ id: "ob", referenceVenue: "OB", assetId: "11:101:Home", selection: { matchId: 11, betId: 101, side: "Home" } }),
    ]);
    expect(rows.map(row => row.signal.id)).toEqual(["newest", "away", "ob"]);
  });

  it("preserves captured labels and EV even after live odds or match markets change", () => {
    const snapshot = {
      matchId: 11, matchTitle: "Alpha vs Beta", marketTitle: "地图1 获胜", side: "Home", sideLabel: "Alpha",
      referenceVenue: "Polymarket", pm: { odds: 2, evPercent: 0 }, ob: { odds: 2.2, evPercent: 10 }, ray: null, pb: null,
    } satisfies PmOddsDropVenueSnapshot;
    const captured = signal({ venueSnapshot: snapshot });
    const rows = matchOddsDropSignals({ ...match, bets: [] } as unknown as ViewMatch, [captured]);
    expect(rows[0]?.snapshot).toBe(snapshot);
    expect(matchOddsDropSignals({ ...match, id: 22 } as unknown as ViewMatch, [captured])).toEqual([]);
  });

  it("does not attach an explicitly selected other match even if its token matches", () => {
    expect(matchOddsDropSignals(match, [signal({ selection: { matchId: 22, betId: 101, side: "Home" } })])).toEqual([]);
  });

  it("keeps full match, map 1 and map 2 signals above their own markets", () => {
    const bets = [0, 1, 2].map(round => ({
      ...match.bets[0], id: 100 + round, round,
      // 相同标题也不得造成跨地图归属。
      getBetName: () => "获胜",
      items: [{ type: "Polymarket", homeId: `map-${round}-home`, awayId: `map-${round}-away`, getOdds: () => 2 }],
    })) as unknown as ViewBet[];
    const multiMapMatch = { ...match, bets } as ViewMatch;
    const signals = bets.flatMap(bet => [
      signal({ id: `pm-${bet.id}`, assetId: bet.items[0]!.homeId }),
      signal({ id: `ob-${bet.id}`, assetId: `11:${bet.id}:Away`, referenceVenue: "OB", selection: { matchId: 11, betId: bet.id, side: "Away" } }),
    ]);
    for (const bet of bets) {
      expect(betOddsDropSignals(multiMapMatch, bet, signals).map(row => row.signal.id))
        .toEqual([`pm-${bet.id}`, `ob-${bet.id}`]);
    }
  });

  it("uses captured market IDs and resolves older PM snapshots by token without moving their EV", () => {
    const captured = matchOddsDropSignals(match, [signal()])[0]!;
    const otherBet = { ...match.bets[0], id: 202 } as ViewBet;
    expect(betOddsDropSignals(match, otherBet, [{ ...captured.signal, venueSnapshot: captured.snapshot }])).toEqual([]);
    const { betId: _betId, ...legacySnapshot } = captured.snapshot;
    const legacy = { ...captured.signal, venueSnapshot: legacySnapshot };
    expect(betOddsDropSignals(match, match.bets[0]!, [legacy])[0]?.snapshot).toBe(legacySnapshot);
    expect(betOddsDropSignals(match, { ...otherBet, items: [] } as unknown as ViewBet, [legacy])).toEqual([]);
  });
});
