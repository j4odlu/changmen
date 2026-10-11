/**
 * sportQuoteHub 独立总线：过滤 + ready；lifecycle 与电竞 marketQuoteHub / ws.ts 隔离。
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import * as sportHub from "../../sportQuoteHub";
import * as sportWs from "../../sportMarketWs";
import * as esportWs from "../../ws";

afterEach(() => {
  sportHub.__testResetPolymarketSportQuoteHub();
  vi.restoreAllMocks();
});

describe("polymarket sportQuoteHub (isolated)", () => {
  test("only registered sport assets; skips invalid price", () => {
    sportHub.setPolymarketSportAssetIds(["a1", "a2"]);
    expect(sportHub.getPolymarketSportAssetIds().sort()).toEqual(["a1", "a2"]);

    const seen: string[] = [];
    const un = sportHub.onPolymarketSportQuote(q => seen.push(q.assetId));
    sportHub.__testPushPolymarketSportQuote("a1", 0.4);
    sportHub.__testPushPolymarketSportQuote("other", 0.5);
    sportHub.__testPushPolymarketSportQuote("a2", 0);
    expect(seen).toEqual(["a1"]);
    un();
    sportHub.clearPolymarketSportHub();
  });

  test("hubBound fires on ensure; uses sportMarketWs, not esport ws.ts", async () => {
    const startSpy = vi.spyOn(sportWs, "startPolymarketSportMarketWs").mockReturnValue({
      send: vi.fn(),
      stop: vi.fn(),
    } as any);
    const esportStart = vi.spyOn(esportWs, "startPolymarketMarketWs");

    let hits = 0;
    const un = sportHub.onPolymarketSportHubBound(() => {
      hits += 1;
    });
    sportHub.setPolymarketSportAssetIds(["e"]);
    await Promise.resolve();
    expect(hits).toBe(1);
    expect(startSpy).toHaveBeenCalled();
    expect(esportStart).not.toHaveBeenCalled();
    un();
    sportHub.clearPolymarketSportHub();
  });

  test("clear stops sport transport only", () => {
    const stop = vi.fn();
    vi.spyOn(sportWs, "startPolymarketSportMarketWs").mockReturnValue({ send: vi.fn(), stop } as any);
    sportHub.setPolymarketSportAssetIds(["x"]);
    sportHub.clearPolymarketSportHub();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  test("ensure connection keeps transport without assets", () => {
    const stop = vi.fn();
    const startSpy = vi.spyOn(sportWs, "startPolymarketSportMarketWs").mockReturnValue({
      send: vi.fn(),
      stop,
    } as any);
    sportHub.ensurePolymarketSportMarketConnection();
    expect(startSpy).toHaveBeenCalled();
    sportHub.setPolymarketSportAssetIds([]);
    expect(stop).not.toHaveBeenCalled();
    sportHub.clearPolymarketSportHub();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
