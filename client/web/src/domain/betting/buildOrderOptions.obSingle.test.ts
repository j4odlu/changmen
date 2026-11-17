import type { PlatformId } from "@/types/esport";
import type { BetSide, ViewBet, ViewBetItem, ViewMatch } from "@/models/match";
import { describe, expect, it } from "vitest";
import { createDefaultUserConfig } from "@/types/userConfig";
import { buildOrderOptions } from "./buildOrderOptions";

function fixture(obOdds = 3, peerOdds = 2, provider: PlatformId = "OB") {
  const item = (type: PlatformId, home: number, away: number) => ({
    type, matchId: type, betId: type, homeId: `${type}-h`, awayId: `${type}-a`,
    getItemId(side: BetSide) { return side === "Home" ? this.homeId : this.awayId; },
    getOdds(side: BetSide) { return side === "Home" ? home : away; },
  } as ViewBetItem);
  const bet = { id: 701, items: [item(provider, obOdds, 1.1), item("RAY", 1.1, peerOdds)], getBetName: () => "全场胜方" } as ViewBet;
  const match = { id: 700, title: "A vs B", game: "英雄联盟", bets: [bet] } as ViewMatch;
  const config = { ...createDefaultUserConfig(), betMoney: 100, profit: 1.01, maxProfit: 2, minOdds: 1.01 };
  return { config, build: (amount = 200) => buildOrderOptions(bet, match, config, [], [provider, "RAY"],
    { getEntry: () => undefined, getPmQuoteEntry: () => undefined }, amount) };
}

describe("OB single uses an independent base with the existing stake allocation", () => {
  it.each([
    [3, 2, "buy", 133.33, 200], [2, 3, "buy", 200, 133.33],
    [3, 2, "total", 80, 120], [2, 3, "total", 120, 80],
  ] as const)("OB %s, peer %s in %s mode", (ob, peer, mode, expectedOb, expectedPeer) => {
    const { config, build } = fixture(ob, peer); config.betMoneyMode = mode;
    const options = build()!;
    expect(options.find(o => o.type === "OB")?.betMoney).toBe(expectedOb);
    expect(options.find(o => o.type === "RAY")?.betMoney).toBe(expectedPeer);
    expect(config.betMoney).toBe(100);
  });

  it("keeps ordinary/9999 amounts when no override is supplied and keeps non-OB pairs unchanged", () => {
    expect(fixture().build(0)?.find(o => o.type === "OB")?.betMoney).toBe(66.67);
    expect(fixture(3, 2, "PB").build()?.find(o => o.type === "PB")?.betMoney).toBe(66.67);
  });

  it("retains hedge rounding and uses the current randomized amount when random buying is enabled", () => {
    const { config, build } = fixture(); config.tenNumber = true;
    expect(build(205)?.find(o => o.type === "OB")?.betMoney).toBe(140);
    Object.assign(config, { tenNumber: false, betMoney: 123, minMoney: 100, maxMoney: 150 });
    expect(build(200)?.find(o => o.type === "OB")?.betMoney).toBe(82);
  });
});
