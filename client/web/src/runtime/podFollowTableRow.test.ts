import { describe, expect, it } from "vitest";
import { parsePodFollowLogRow } from "./podFollowLog";
import { formatPodTableDate, podFollowTableValues, podFollowTableQuotes, podFollowTableVenues, type PodFollowTableLive, type PodFollowTableRow } from "./podFollowTableRow";

function row(placed = false): PodFollowTableRow {
  return {
    log: parsePodFollowLogRow({ id: "alert-1", home: "Stabaek II", away: "Haugesund II", league: "Norway",
      sideLabel: "主 -1.25", marketLabel: "全场让球", pinPrevious: 2.31, pinCurrent: 1.751,
      nvp: 1.8, obQuote: 1.95, minObOdds: 1.9, maxObOdds: 2.2, oid: "saved-oid", obMid: "5726365", at: 1000 })!,
    live: {
      alert: { home: "Stabaek B", away: "Haugesund B", league: "Norway Division 3", alertedAt: 1000 },
      sideLabel: "主 -1", marketLabel: "全场让球", pinPrevious: 2.2, pinCurrent: 1.7,
      nvp: 1.75, minObOdds: 1.8, maxObOdds: 2.1, dropPct: 20, starts: 1791111600000,
      fixtureMatch: { hits: [] }, marketMatch: { oid: "current-oid" },
      obQuote: { quote: 2.05, evPercent: 17.14, status: "ok" },
    } as unknown as PodFollowTableLive,
    pending: { placed, label: placed ? "已下" : "未下", detail: "", tone: placed ? "ok" : "ready" },
  };
}

describe("POD table historical snapshots", () => {
  it("keeps the submitted selection and prices after the live line and quote change", () => {
    const placed = row(true);
    placed.live!.fixtureMatch.hits = [{ fixture: { obMid: "different-live-mid" } }] as PodFollowTableLive["fixtureMatch"]["hits"];
    expect(podFollowTableValues(placed)).toMatchObject({
      home: "Stabaek II", side: "主 -1.25", pinPrevious: 2.31, pinCurrent: 1.751,
      nvp: 1.8, quote: 1.95, minOdds: 1.9, maxOdds: 2.2, oid: "saved-oid", obMid: "5726365", quoteStatus: "snapshot",
    });
  });
  it("uses the current ticket for opportunities that have not been submitted", () => {
    expect(podFollowTableValues(row())).toMatchObject({ home: "Stabaek B", side: "主 -1", quote: 2.05, oid: "current-oid" });
  });
  it("does not invent kickoff times or receipts for logs without a live ticket", () => {
    const historic = row(true);
    historic.live = undefined;
    expect(podFollowTableValues(historic)).toMatchObject({ starts: 0, accounts: "", quote: 1.95 });
    expect(formatPodTableDate(0)).toBe("—");
    expect(formatPodTableDate(Number.NaN)).toBe("—");
  });
});

describe("POD multi-venue quote display", () => {
  function multiVenueRow(placed = false) {
    const result = row(placed);
    const live = result.live!;
    live.fixtureMatch.status = "matched";
    live.pmFixtureMatch = { ...live.fixtureMatch };
    live.rayFixtureMatch = { ...live.fixtureMatch };
    live.pmMarketMatch = { ...live.marketMatch, nvp: 1.6 };
    live.rayMarketMatch = { ...live.marketMatch, nvp: 1.7 };
    live.pmQuote = { status: "ok", quote: 2.1, evPercent: 31.25, minObOdds: 1.65, maxObOdds: 2.2 };
    live.rayQuote = { status: "short", quote: 1.6, evPercent: -5.88, minObOdds: 1.8, maxObOdds: 2.3 };
    return result;
  }

  it("uses each venue's own quote, EV and acceptable range", () => {
    expect(podFollowTableQuotes(multiVenueRow())).toMatchObject([
      { venue: "OB", quote: 2.05, ev: 17.14, snapshot: false },
      { venue: "PM", quote: 2.1, ev: 31.25, nvp: 1.6, minOdds: 1.65, maxOdds: 2.2 },
      { venue: "RAY", quote: 1.6, ev: -5.88, nvp: 1.7, status: "short" },
    ]);
  });

  it("keeps the submitted OB quote separate from other venues' current quotes", () => {
    expect(podFollowTableQuotes(multiVenueRow(true))).toMatchObject([
      { venue: "OB", quote: 1.95, snapshot: true },
      { venue: "PM", quote: 2.1, snapshot: false },
      { venue: "RAY", quote: 1.6, snapshot: false },
    ]);
  });

  it("does not invent an OB quote when only other venues matched", () => {
    const result = multiVenueRow();
    result.live!.fixtureMatch.status = "none";
    expect(podFollowTableQuotes(result).map(quote => quote.venue)).toEqual(["PM", "RAY"]);
  });

  it("does not guess the venue for old unsubmitted quote logs", () => {
    const result = row();
    result.live = undefined;
    expect(podFollowTableQuotes(result)).toMatchObject([{ venue: "历史", quote: 1.95, snapshot: false, historical: true }]);
  });

  it("keeps PM's own match ID, quote, account plan and execution state together", () => {
    const result = multiVenueRow();
    result.live!.fixtureMatch.status = "none";
    result.live!.rayFixtureMatch.status = "none";
    result.live!.pmFixtureMatch.hits = [{ swapped: false, score: 1, fixture: {
      id: 88, pmMid: "pm-88", providers: { Polymarket: "pm-88" }, obMid: "", title: "Stabaek B vs Haugesund B",
      game: "Norway", startAt: 1791111600000, homeName: "Stabaek B", awayName: "Haugesund B", markets: [],
    } }];
    result.venueStates = { Polymarket: { placed: false, label: "提交中", detail: "PM执行中", tone: "wait",
      accountIds: [328], plannedStake: "¥50", submittedAt: 0 } };
    expect(podFollowTableVenues(result)).toMatchObject([{ venue: "Polymarket", label: "PM", matchId: "pm-88", fixtureId: 88,
      quote: 2.1, nvp: 1.6, minOdds: 1.65, accountIds: [328], plannedStake: "¥50", stateLabel: "提交中", stateDetail: "PM执行中" }]);
  });

  it("shows a submitted RAY reference and receipt after reload without borrowing OB data", () => {
    const result = row();
    result.live = undefined;
    result.log.starts = 1791111600000;
    result.log.alertedAt = 900;
    result.log.venues = { RAY: { venue: "RAY", fixtureId: 44, matchId: "ray-44", obMid: "", oid: "ray-oid",
      marketCode: "spreads", side: "home", line: -1.25, quote: 2.2, ev: 22.2, nvp: 1.8, minOdds: 1.9, maxOdds: 2.4,
      submittedAt: 1100, note: "RAY已提交 alice:task-1" } };
    expect(podFollowTableValues(result)).toMatchObject({ starts: 1791111600000, at: 900 });
    expect(podFollowTableVenues(result)).toMatchObject([{ label: "RAY", matchId: "ray-44", quote: 2.2,
      snapshot: true, submittedAt: 1100, receipt: "RAY已提交 alice:task-1", stateLabel: "已提交" }]);
  });
});
