import type { ArbMarketWatchContext } from "@/extensions/arbMarketWatch/marketWatchContext";
import type { ArbOpportunity } from "@changmen/arb-core/opportunity/types";
import { describe, expect, it } from "vitest";
import { formatMarketWatchGroup } from "@/extensions/arbMarketWatch/formatMarketWatch";

function makeOpp(scope: "fullMarket" | "funded", patch: Partial<ArbOpportunity> = {}): ArbOpportunity {
  return {
    scope,
    matchId: 100,
    betId: 1,
    matchTitle: "Team A vs Team B",
    betName: "[地图1] 获胜",
    homePlatform: "PB",
    awayPlatform: "RAY",
    homeItemId: "h1", awayItemId: "a2",
    homeOdds: 2.1,
    awayOdds: 2.2,
    implied: 1.05,
    ...patch,
  };
}

function makeContext(patch: Partial<ArbMarketWatchContext> = {}): ArbMarketWatchContext {
  return {
    game: "英雄联盟",
    homeName: "New tones",
    awayName: "Luxe Gaming",
    startAt: Date.parse("2026-06-18T14:00:00+08:00"),
    bo: 3,
    liveRound: 2,
    betRound: 2,
    isLiveBet: true,
    linkedPlatforms: ["RAY", "IA", "TF"],
    platformOdds: [
      { platform: "RAY", homeOdds: 2.31, awayOdds: 1.65, hasAccount: true },
      { platform: "IA", homeOdds: 1.52, awayOdds: 1.87, hasAccount: true },
    ],
    minProfit: 1.03,
    maxProfit: 1.2,
    minOdds: 1.5,
    bettingEnabled: true,
    ...patch,
  };
}

describe("formatMarketWatchGroup", () => {
  it("formats appeared as compact 4-line message when executable", () => {
    const body = formatMarketWatchGroup({
      kind: "appeared",
      anchor: "100:1",
      matchTitle: "Team A vs Team B",
      betName: "[地图1] 获胜",
      fullMarket: makeOpp("fullMarket"),
      funded: makeOpp("funded"),
      context: makeContext(),
    });
    const lines = body.split("\n");
    expect(lines).toHaveLength(4);
    expect(body).toContain("🔶 套利机会");
    expect(body).toContain("[英雄联盟] New tones vs Luxe Gaming · [地图1] 获胜");
    expect(body).toContain("PB@2.100(主) ↔ RAY@2.200(客)");
    expect(body).toContain("可执行：是");
    expect(body).not.toContain("各平台赔率");
    expect(body).not.toContain("门槛：");
  });

  it("formats appeared when funded missing with short reason", () => {
    const body = formatMarketWatchGroup({
      kind: "appeared",
      anchor: "100:1",
      matchTitle: "Team A vs Team B",
      betName: "[地图2] 获胜",
      fullMarket: makeOpp("fullMarket", {
        homePlatform: "RAY",
        awayPlatform: "IA",
        homeOdds: 2.31,
        awayOdds: 1.87,
        implied: 1.033,
      }),
      context: makeContext({
        platformOdds: [
          { platform: "RAY", homeOdds: 2.31, awayOdds: 1.65, hasAccount: true },
          { platform: "IA", homeOdds: 1.52, awayOdds: 1.87, hasAccount: false },
        ],
      }),
    });
    expect(body).toContain("RAY@2.310(主) ↔ IA@1.870(客)");
    expect(body).toContain("可执行：无（IA(客，无可用账号)）");
  });

  it("formats appeared when betting disabled", () => {
    const body = formatMarketWatchGroup({
      kind: "appeared",
      anchor: "214:876547",
      matchTitle: "WST vs 济南RW侠",
      betName: "[地图3] 获胜",
      fullMarket: makeOpp("fullMarket", {
        matchId: 214,
        betId: 876547,
        homePlatform: "OB",
        awayPlatform: "RAY",
        homeOdds: 2.278,
        awayOdds: 1.94,
        implied: 1.048,
      }),
      funded: makeOpp("funded", {
        matchId: 214,
        betId: 876547,
        homePlatform: "OB",
        awayPlatform: "RAY",
        homeOdds: 2.278,
        awayOdds: 1.94,
        implied: 1.048,
      }),
      context: makeContext({
        bettingEnabled: false,
        platformOdds: [
          { platform: "OB", homeOdds: 2.278, awayOdds: 1.6, hasAccount: false },
          { platform: "RAY", homeOdds: 1.8, awayOdds: 1.94, hasAccount: false },
        ],
      }),
    });
    expect(body).toContain("可执行：未开启买入");
    expect(body).not.toContain("无可用账号");
  });

  it("formats appeared with different fullMarket and funded legs", () => {
    const body = formatMarketWatchGroup({
      kind: "appeared",
      anchor: "100:1",
      matchTitle: "Team A vs Team B",
      betName: "[地图2] 获胜",
      fullMarket: makeOpp("fullMarket", { awayPlatform: "OB", awayOdds: 2.8, implied: 1.08 }),
      funded: makeOpp("funded"),
      context: makeContext(),
    });
    expect(body).toContain("OB@2.800(客)");
    expect(body).toContain("可执行：PB@2.100(主) ↔ RAY@2.200(客)");
  });

  it("formats gone opportunity as compact 2-line message", () => {
    const body = formatMarketWatchGroup({
      kind: "gone",
      anchor: "100:1",
      matchTitle: "Team A vs Team B",
      betName: "[地图1] 获胜",
      fullMarket: makeOpp("fullMarket"),
      funded: makeOpp("funded"),
      context: makeContext(),
    });
    const lines = body.split("\n");
    expect(lines).toHaveLength(2);
    expect(body).toContain("⚪ 套利机会结束");
    expect(body).toContain("[英雄联盟] New tones vs Luxe Gaming · [地图1] 获胜");
  });
});
