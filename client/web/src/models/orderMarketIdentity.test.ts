import { describe, expect, it } from "vitest";
import { BetOption } from "@changmen/client-core/models/betOption";
import { LoseOrder } from "@changmen/client-core/models/loseOrder";
import { ViewBet, ViewMatch } from "@changmen/client-core/models/match";

describe("order selection identity", () => {
  it("captures the composed map on each leg independently of its venue market", () => {
    const match = new ViewMatch({ ID: 17, Title: "A vs B", Game: "CS2", GameID: 1, StartTime: 1700000000000, Matchs: { Polymarket: "venue-match" },
      Bets: [{ ID: 22, MatchID: 17, HomeID: 1, AwayID: 2, HomeName: "A", AwayName: "B", Name: "winner", Map: 3,
        Sources: { Polymarket: { Type: "Polymarket", BetID: "native-full", HomeID: "token-a", AwayID: "token-b", HomeOdds: 2, AwayOdds: 2 } } }] });
    const bet: ViewBet = match.bets[0]!;
    const option = new BetOption(match, bet, bet.items[0]!, "Home", 100);
    expect(option.clientMarket).toMatchObject({ matchId: 17, betId: 22, round: 3 });
    expect(option.betId).toBe("native-full");
    bet.round = 2;
    expect(option.clientMarket?.round).toBe(3);
    const queued = new LoseOrder({ matchId: 17, betId: 22, linkId: 1700000000000, clientMarket: option.clientMarket });
    const restored = new LoseOrder(JSON.parse(JSON.stringify(queued)));
    expect(restored.clientMarket).toEqual(option.clientMarket);
  });
  it("keeps restored legacy makeup records without fabricated map metadata", () => {
    expect(new LoseOrder({ matchId: 17, betId: 22, bet: "地图3" }).clientMarket).toBeUndefined();
  });
});
