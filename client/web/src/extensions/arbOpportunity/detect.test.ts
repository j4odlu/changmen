import "@/test/mockFoOdds";
import { foOddsState } from "@/test/mockFoOdds";
import type { BetRowDto, ClientMatchDto, PlatformId } from "@/types/esport";
import { beforeEach, describe, expect, it } from "vitest";
import { pickArbLegs } from "@changmen/arb-core";
import { providerKeysFromBetItems } from "@changmen/arb-core/providerKeys";
import {
  detectOpportunities,
  findFundedOpportunityForBet,
  indexOpportunities,
} from "@changmen/arb-core/opportunity/detect";
import { opportunityKey } from "@changmen/arb-core/opportunity/types";
import { ViewBet, ViewMatch } from "@/models/match";
import { createDefaultUserConfig } from "@/types/userConfig";

beforeEach(() => {
  foOddsState.current = {};
});

function makeBet(id: number, sources: BetRowDto["Sources"]) {
  const row: BetRowDto = {
    ID: id,
    MatchID: 100,
    HomeID: 1,
    AwayID: 2,
    HomeName: "A",
    AwayName: "B",
    Name: "",
    Map: id === 1 ? 1 : 2,
    Sources: sources,
  };
  return new ViewBet(row, { PB: "m1", RAY: "m2", OB: "m3" }, 0, 0);
}

function makeMatch(bets: ViewBet[]): ViewMatch {
  const dto: ClientMatchDto = {
    ID: 100,
    Title: "Team A vs Team B",
    Game: "英雄联盟",
    GameID: 1,
    BO: 3,
    StartTime: Date.now(),
    Round: 0,
    RoundStart: 0,
    Reverse: [],
    Matchs: { PB: "m1", RAY: "m2", OB: "m3" },
    Bets: [],
  };
  const match = new ViewMatch(dto);
  match.bets = bets;
  return match;
}

const arbSources: BetRowDto["Sources"] = {
  PB: {
    Type: "PB",
    BetID: "b1",
    HomeID: "h1",
    AwayID: "a1",
    HomeOdds: 2.1,
    AwayOdds: 1.5,
  },
  RAY: {
    Type: "RAY",
    BetID: "b2",
    HomeID: "h2",
    AwayID: "a2",
    HomeOdds: 1.6,
    AwayOdds: 2.2,
  },
};

const arbSourcesWithOb: BetRowDto["Sources"] = {
  ...arbSources,
  OB: {
    Type: "OB",
    BetID: "b3",
    HomeID: "h3",
    AwayID: "a3",
    HomeOdds: 1.5,
    AwayOdds: 2.5,
  },
};

describe("detectOpportunities", () => {
  it("fullMarket scope scans all bet platforms", () => {
    foOddsState.current = {
      PB: { h1: 2.0, a1: 1.5 },
      RAY: { h2: 1.6, a2: 2.0 },
      OB: { h3: 1.5, a3: 2.5 },
    };
    const config = { ...createDefaultUserConfig(), profit: 1.03, maxProfit: 1.2, minOdds: 1.01 };
    const bet = makeBet(1, arbSourcesWithOb);
    const params = {
      matches: [makeMatch([bet])],
      config,
      actionablePlatforms: ["PB", "RAY"] as PlatformId[],
    };
    const opps = detectOpportunities(params, "fullMarket");

    expect(opps).toHaveLength(1);
    expect(opps[0]).toMatchObject({
      scope: "fullMarket",
      homePlatform: "PB",
      awayPlatform: "OB",
    });
  });

  it("funded scope uses getProviders only (aligned with A8)", () => {
    foOddsState.current = {
      PB: { h1: 2.0, a1: 1.5 },
      RAY: { h2: 1.6, a2: 2.2 },
      OB: { h3: 1.5, a3: 2.5 },
    };
    const config = { ...createDefaultUserConfig(), profit: 1.03, maxProfit: 1.2, minOdds: 1.01 };
    const bet = makeBet(1, arbSourcesWithOb);
    const params = {
      matches: [makeMatch([bet])],
      config,
      actionablePlatforms: ["PB", "RAY"] as PlatformId[],
    };
    const opps = detectOpportunities(params, "funded");

    expect(opps).toHaveLength(1);
    expect(opps[0]).toMatchObject({
      scope: "funded",
      homePlatform: "PB",
      awayPlatform: "RAY",
    });
  });

  it("findFundedOpportunityForBet lazy lookup by bet", () => {
    foOddsState.current = {
      PB: { h1: 2.0, a1: 1.5 },
      RAY: { h2: 1.6, a2: 2.2 },
      OB: { h3: 1.5, a3: 2.5 },
    };
    const config = { ...createDefaultUserConfig(), profit: 1.03, maxProfit: 1.2, minOdds: 1.01 };
    const bet = makeBet(1, arbSourcesWithOb);
    const params = {
      matches: [makeMatch([bet])],
      config,
      actionablePlatforms: ["PB", "RAY"] as PlatformId[],
    };
    const funded = findFundedOpportunityForBet(params, 100, 1);
    expect(funded?.awayPlatform).toBe("RAY");
  });

  it("fullMarket matches useBetRowArbUi / pickArbLegs", () => {
    foOddsState.current = {
      PB: { h1: 2.1, a1: 1.5 },
      RAY: { h2: 1.6, a2: 2.2 },
    };
    const config = { ...createDefaultUserConfig(), profit: 1.03, maxProfit: 1.2, minOdds: 1.01 };
    const bet = makeBet(1, arbSources);
    const match = makeMatch([bet]);
    const legs = pickArbLegs(bet, config, providerKeysFromBetItems(bet), [], match.game);
    const opps = detectOpportunities({ matches: [match], config }, "fullMarket");

    expect(legs).toBeDefined();
    expect(opps[0]!.homePlatform).toBe(legs!.homeItem.type);
    expect(opps[0]!.awayPlatform).toBe(legs!.awayItem.type);
  });
});

describe("indexOpportunities", () => {
  it("keys opportunities by match, bet, and leg platforms", () => {
    const opp = {
      scope: "funded" as const,
      matchId: 100,
      betId: 1,
      matchTitle: "A vs B",
      betName: "地图1",
      homePlatform: "PB" as const,
      awayPlatform: "RAY" as const,
      homeItemId: "h1", awayItemId: "a2",
      homeOdds: 2.1,
      awayOdds: 2.2,
      implied: 1.05,
    };
    const map = indexOpportunities([opp]);
    expect(map.get(opportunityKey(opp))).toEqual(opp);
  });
});
