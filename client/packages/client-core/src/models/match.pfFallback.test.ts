import { describe, expect, it } from "vitest";
import { ViewBetItem } from "./match.js";

describe("ViewBetItem PredictFun (esport)", () => {
  it("does not use GetMatchs Sources odds as fallback; keeps MarketID subscribe keys", () => {
    const item = new ViewBetItem(
      {
        Type: "PredictFun",
        BetID: "slug#m3",
        HomeID: "tok-h",
        AwayID: "tok-a",
        HomeOdds: 2.439,
        AwayOdds: 1.612,
        Status: "Normal",
        HomeMarketID: "844582",
        AwayMarketID: "844582",
      },
      "218389",
    );
    expect(item.fallbackHomeOdds).toBe(0);
    expect(item.fallbackAwayOdds).toBe(0);
    expect(item.homeSubscribeId).toBe("844582");
    expect(item.awaySubscribeId).toBe("844582");
    expect(item.getOdds("Home")).toBe(0);
    expect(item.getOdds("Away")).toBe(0);
  });
});
