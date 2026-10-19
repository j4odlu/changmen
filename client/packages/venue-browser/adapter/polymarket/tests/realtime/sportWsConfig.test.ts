import { afterEach, describe, expect, it } from "vitest";
import { POLYMARKET_MARKET_WS } from "@changmen/venue-browser/polymarket/api";
import { resetPmMarketWsSourceModeForTests, setPmMarketWsSourceMode } from "@changmen/venue-browser/polymarket/pmMarketWsMode";
import { PM_SPORT_MARKET_WS_FORWARD_PATH, resolvePolymarketSportMarketWsUrl } from "../../sportWsConfig";

afterEach(resetPmMarketWsSourceModeForTests);

describe("football PM market routing", () => {
  it("uses official WS when the existing reachability mode is official", () => {
    setPmMarketWsSourceMode("official");
    expect(resolvePolymarketSportMarketWsUrl()).toBe(POLYMARKET_MARKET_WS);
  });

  it("uses isolated sport relay when official PM is unavailable", () => {
    setPmMarketWsSourceMode("changmen");
    expect(resolvePolymarketSportMarketWsUrl()).toContain(PM_SPORT_MARKET_WS_FORWARD_PATH);
  });

  it("accepts an isolated fallback mode without mutating the esport source mode", () => {
    setPmMarketWsSourceMode("official");
    expect(resolvePolymarketSportMarketWsUrl("changmen")).toContain(PM_SPORT_MARKET_WS_FORWARD_PATH);
    expect(resolvePolymarketSportMarketWsUrl()).toBe(POLYMARKET_MARKET_WS);
  });
});
