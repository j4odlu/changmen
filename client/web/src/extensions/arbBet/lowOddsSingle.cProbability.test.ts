import type { PmPrematchTokenSnapshot } from "@changmen/api-contract";
import type { ViewBet, ViewMatch } from "@/models/match";
import { describe, expect, it } from "vitest";
import { explainLowOddsCProbabilityRejection } from "./lowOddsSingle";

const point = (tokenId: string, price: number): PmPrematchTokenSnapshot => ({
  tokenId, price, marketId: "map-1", status: "ready", registeredStart: 101000, cutoff: 100,
  observationTime: 99000, resolution: 0, checkedAt: 105000, nextCheckAt: 705000,
});
function fixture(reversed = false) {
  const bet = { round: 1, items: [{ type: "Polymarket", homeId: reversed ? "away" : "home", awayId: reversed ? "home" : "away" }] } as ViewBet;
  const match = { pmPrematch: { home: point("home", .65), away: point("away", .35) } } as unknown as ViewMatch;
  return { bet, match };
}

describe("LOS C row filter", () => {
  it.each([false, true])("uses the current market's aligned token direction (reversed=%s)", reversed => {
    const { bet, match } = fixture(reversed);
    expect(explainLowOddsCProbabilityRejection(bet, match, reversed ? "Away" : "Home")).toBeNull();
    expect(explainLowOddsCProbabilityRejection(bet, match, reversed ? "Home" : "Away")).toContain("低于对侧");
  });
  it.each(["no-pm", "waiting", "pending", "missing", "error", "tie", "wrong-market", "wrong-cutoff", "post-cutoff", "invalid-price", "sport", "unsupported-round"])("skips %s", kind => {
    const { bet, match } = fixture(); const data = match.pmPrematch!;
    if (kind === "no-pm") bet.items = [];
    if (kind === "waiting") delete data.away;
    if (kind === "pending" || kind === "missing" || kind === "error") data.home!.status = kind;
    if (kind === "tie") data.away!.price = data.home!.price;
    if (kind === "wrong-market") data.away!.marketId = "map-2";
    if (kind === "wrong-cutoff") data.away!.cutoff = 200;
    if (kind === "post-cutoff") data.home!.observationTime = 101000;
    if (kind === "invalid-price") data.home!.price = Number.NaN;
    if (kind === "sport") bet.marketCode = "moneyline";
    if (kind === "unsupported-round") bet.round = -1;
    expect(explainLowOddsCProbabilityRejection(bet, match, "Home")).toMatch(/^LOS C 行过滤：/);
  });
  it("does not substitute another market's C row or infer a missing direction", () => {
    const { bet, match } = fixture();
    expect(explainLowOddsCProbabilityRejection(bet, match, undefined as never)).toContain("无法确定");
    bet.items[0]!.homeId = "other-home"; bet.items[0]!.awayId = "other-away";
    expect(explainLowOddsCProbabilityRejection(bet, match, "Home")).toContain("等待");
  });
});
