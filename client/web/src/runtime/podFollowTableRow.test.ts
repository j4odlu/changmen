import { describe, expect, it } from "vitest";
import { parsePodFollowLogRow } from "./podFollowLog";
import { formatPodTableDate, podFollowTableValues, type PodFollowTableLive, type PodFollowTableRow } from "./podFollowTableRow";

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
