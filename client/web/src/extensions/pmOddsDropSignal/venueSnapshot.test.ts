import type { PmOddsDropSignal } from "./detector";
import type { ViewMatch } from "@/models/match";
import { describe, expect, it } from "vitest";
import {
  pmVenueEvPercent,
  readReferenceVenueQuotes,
  referenceQuoteKey,
  resolvePmOddsDropVenueSnapshot,
} from "./venueSnapshot";

function signal(assetId = "pm-home", currentOdds = 2): PmOddsDropSignal {
  return {
    id: "signal-1",
    assetId,
    beforeBestAsk: 0.4,
    currentBestAsk: 0.5,
    beforeOdds: 2.5,
    currentOdds,
    dropPct: 20,
    windowMs: 1_000,
    baselineAt: 1_000,
    detectedAt: 2_000,
  };
}

function matches(): ViewMatch[] {
  const odds: Record<string, { Home: number; Away: number }> = {
    Polymarket: { Home: 2, Away: 2.05 },
    OB: { Home: 2.1, Away: 1.82 },
    RAY: { Home: 1.9, Away: 2.2 },
    PB: { Home: 2.2, Away: 1.75 },
  };
  return [{
    id: 11,
    title: "Alpha vs Beta",
    bets: [{
      id: 101,
      homeName: "Alpha",
      awayName: "Beta",
      getBetName: () => "[地图1] 获胜",
      items: [
        { type: "Polymarket", homeId: "pm-home", awayId: "pm-away", getOdds: (side: "Home" | "Away") => odds.Polymarket[side] },
        { type: "OB", homeId: "ob-home", awayId: "ob-away", getOdds: (side: "Home" | "Away") => odds.OB[side] },
        { type: "RAY", homeId: "ray-home", awayId: "ray-away", getOdds: (side: "Home" | "Away") => odds.RAY[side] },
        { type: "PB", homeId: "pb-home", awayId: "pb-away", getOdds: (side: "Home" | "Away") => odds.PB[side] },
      ],
    }],
  }] as unknown as ViewMatch[];
}

describe("pm odds drop venue EV snapshot", () => {
  it("uses the same target-odds divided by benchmark-odds EV formula as football POD", () => {
    expect(pmVenueEvPercent(2.1, 2)).toBe(5);
    expect(pmVenueEvPercent(1.9, 2)).toBe(-5);
  });

  it("snapshots OB and RAY from the same market and canonical side", () => {
    const snapshot = resolvePmOddsDropVenueSnapshot(matches(), signal());

    expect(snapshot).toMatchObject({
      matchId: 11,
      matchTitle: "Alpha vs Beta",
      marketTitle: "[地图1] 获胜",
      side: "Home",
      sideLabel: "Alpha",
      ob: { odds: 2.1, evPercent: 5 },
      ray: { odds: 1.9, evPercent: -5 },
    });
  });

  it("uses away-side quotes when the PM away token triggers", () => {
    const snapshot = resolvePmOddsDropVenueSnapshot(matches(), signal("pm-away", 2));

    expect(snapshot).toMatchObject({
      side: "Away",
      sideLabel: "Beta",
      ob: { odds: 1.82, evPercent: -9 },
      ray: { odds: 2.2, evPercent: 10 },
    });
  });

  it("builds stable OB polling quotes for both sides without writing venue state", () => {
    const quotes = readReferenceVenueQuotes(matches(), "OB");

    expect(quotes).toEqual([
      {
        key: referenceQuoteKey({ matchId: 11, betId: 101, side: "Home" }),
        odds: 2.1,
        selection: { matchId: 11, betId: 101, side: "Home" },
      },
      {
        key: referenceQuoteKey({ matchId: 11, betId: 101, side: "Away" }),
        odds: 1.82,
        selection: { matchId: 11, betId: 101, side: "Away" },
      },
    ]);
  });

  it("uses selected OB as trigger and EV benchmark", () => {
    const selection = { matchId: 11, betId: 101, side: "Home" } as const;
    const snapshot = resolvePmOddsDropVenueSnapshot(
      matches(),
      signal(referenceQuoteKey(selection), 1.8),
      "OB",
      selection,
    );

    expect(snapshot).toMatchObject({
      referenceVenue: "OB",
      pm: { odds: 2, evPercent: 11.11 },
      ob: { odds: 1.8, evPercent: 0 },
      ray: { odds: 1.9, evPercent: 5.56 },
      pb: { odds: 2.2, evPercent: 22.22 },
    });
  });

  it("reads PB as a selectable trigger venue and uses its exact trigger price", () => {
    const selection = { matchId: 11, betId: 101, side: "Away" } as const;
    const quotes = readReferenceVenueQuotes(matches(), "PB");
    const snapshot = resolvePmOddsDropVenueSnapshot(
      matches(),
      signal(referenceQuoteKey(selection), 1.7),
      "PB",
      selection,
    );

    expect(quotes).toContainEqual({
      key: "11:101:Away",
      odds: 1.75,
      selection,
    });
    expect(snapshot).toMatchObject({
      referenceVenue: "PB",
      pm: { odds: 2.05, evPercent: 20.59 },
      ob: { odds: 1.82, evPercent: 7.06 },
      ray: { odds: 2.2, evPercent: 29.41 },
      pb: { odds: 1.7, evPercent: 0 },
    });
  });

  it("returns null rather than borrowing odds from another market", () => {
    expect(resolvePmOddsDropVenueSnapshot(matches(), signal("unknown"))).toBeNull();
  });
});
