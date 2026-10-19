/**
 * PM marketQuoteHub 生命周期契约（热路径闸门）。
 * 改 hub / collect 启停 / 同集重订前：本文件必须绿。
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  __testPushPolymarketMarketQuote,
  __testResetPolymarketMarketQuoteHub,
  ensurePolymarketMarketQuoteHub,
  getPolymarketQuoteConsumerAssetIds,
  onPolymarketMarketQuote,
  registerPolymarketQuoteAssets,
  stopPolymarketMarketQuoteHub,
  unregisterPolymarketQuoteConsumer,
} from "../../marketQuoteHub";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

afterEach(() => {
  __testResetPolymarketMarketQuoteHub();
  vi.restoreAllMocks();
});

async function mockPmWs() {
  const ws = await import("@changmen/venue-browser/polymarket/ws");
  const send = vi.fn();
  const stop = vi.fn();
  const startSpy = vi.spyOn(ws, "startPolymarketMarketWs").mockReturnValue({ send, stop } as any);
  return { send, stop, startSpy };
}

describe("PM marketQuoteHub lifecycle contracts", () => {
  test("force=true resubscribes even when asset set unchanged (hub ready / transport rebuild)", async () => {
    const { send } = await mockPmWs();
    registerPolymarketQuoteAssets("esport", ["a", "b"]);
    expect(send).toHaveBeenCalledTimes(1);
    registerPolymarketQuoteAssets("esport", ["b", "a"], true);
    expect(send).toHaveBeenCalledTimes(2);
    const last = JSON.parse(String(send.mock.calls.at(-1)?.[0]));
    expect(last.initial_dump).toBe(false);
  });

  test("same asset set without force does not resubscribe", async () => {
    const { send } = await mockPmWs();
    registerPolymarketQuoteAssets("esport", ["a", "b"]);
    expect(send).toHaveBeenCalledTimes(1);
    registerPolymarketQuoteAssets("esport", ["b", "a"]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  test("preconnect starts transport without sending an empty subscription", async () => {
    const { send, startSpy } = await mockPmWs();
    ensurePolymarketMarketQuoteHub();
    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });

  test("session stop tears down a preconnected transport with no consumers", async () => {
    const { stop } = await mockPmWs();
    ensurePolymarketMarketQuoteHub();
    stopPolymarketMarketQuoteHub();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  test("unregister esport keeps transport when sport still registered", async () => {
    const { stop, send } = await mockPmWs();
    registerPolymarketQuoteAssets("esport", ["e1"]);
    registerPolymarketQuoteAssets("sport", ["s1"]);
    expect(stop).not.toHaveBeenCalled();
    unregisterPolymarketQuoteConsumer("esport");
    expect(stop).not.toHaveBeenCalled();
    expect(getPolymarketQuoteConsumerAssetIds("sport")).toEqual(["s1"]);
    expect(send.mock.calls.length).toBeGreaterThanOrEqual(2);
    const last = JSON.parse(String(send.mock.calls.at(-1)?.[0]));
    expect(last.assets_ids).toEqual(["s1"]);
  });

  test("last consumer unregister stops transport", async () => {
    const { stop } = await mockPmWs();
    registerPolymarketQuoteAssets("esport", ["e1"]);
    unregisterPolymarketQuoteConsumer("esport");
    expect(stop).toHaveBeenCalledTimes(1);
  });

  test("late-join esport onto live sport hub uses initial_dump", async () => {
    const { send } = await mockPmWs();
    registerPolymarketQuoteAssets("sport", ["s1"]);
    send.mockClear();
    registerPolymarketQuoteAssets("esport", ["e1", "e2"]);
    expect(send).toHaveBeenCalledTimes(1);
    const last = JSON.parse(String(send.mock.calls[0]?.[0]));
    expect(last.initial_dump).toBe(true);
    expect(last.assets_ids.sort()).toEqual(["e1", "e2", "s1"]);
  });

  test("collector-restart pattern: unregister then re-register rejoins without killing sport", async () => {
    const { send, stop } = await mockPmWs();
    registerPolymarketQuoteAssets("sport", ["s1"]);
    registerPolymarketQuoteAssets("esport", ["e1"]);
    unregisterPolymarketQuoteConsumer("esport");
    expect(stop).not.toHaveBeenCalled();
    send.mockClear();
    registerPolymarketQuoteAssets("esport", ["e1"]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(getPolymarketQuoteConsumerAssetIds("sport")).toEqual(["s1"]);
    expect(getPolymarketQuoteConsumerAssetIds("esport")).toEqual(["e1"]);
  });

  test("simulated esport fo filter: only mapped assets call saveVenueOdds", async () => {
    const oddsAccess = await import("@changmen/client-core/bridge/oddsAccess");
    const spy = vi.spyOn(oddsAccess, "saveVenueOdds").mockImplementation(() => {});
    const assetToMarket = new Map([["eHome", "m1"]]);

    registerPolymarketQuoteAssets("esport", ["eHome", "sSport"]);
    const un = onPolymarketMarketQuote((q) => {
      if (!assetToMarket.has(q.assetId))
        return;
      oddsAccess.saveVenueOdds("Polymarket", {
        id: q.assetId,
        odds: 1 / q.bestAsk,
        isLock: false,
        time: Date.now(),
      }, "mqtt");
    });

    __testPushPolymarketMarketQuote("sSport", 0.4);
    expect(spy).not.toHaveBeenCalled();
    __testPushPolymarketMarketQuote("eHome", 0.5);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[1]?.id).toBe("eHome");

    // prune: drop mapping → ghost no longer writes fo
    assetToMarket.clear();
    __testPushPolymarketMarketQuote("eHome", 0.45);
    expect(spy).toHaveBeenCalledTimes(1);

    un();
  });
});

describe("PM collect / hub source contracts", () => {
  test("collect stop only unregister esport; hub-ready force only; no unchanged-index resub; no sport re-export", () => {
    const src = readFileSync(join(root, "../../polymarket/markets/collect.ts"), "utf8");
    expect(src).toMatch(/unregisterPolymarketQuoteConsumer\(QUOTE_CONSUMER\)/);
    expect(src).not.toMatch(/clearPolymarketSportHub/);
    expect(src).toMatch(/onPolymarketMarketHubReady\(\(\) => \{\s*syncEsportAssets\(true\);/);
    expect(src).toMatch(/if \(index\.updatedAt === lastIndexUpdatedAt\)\s*return;/);
    expect(src).not.toMatch(/updatedAt === lastIndexUpdatedAt\)[\s\S]{0,80}syncEsportAssets\(true\)/);
    expect(src).toMatch(/marketsById\.clear\(\)/);
    expect(src).toMatch(/assetToMarket\.clear\(\)/);
    expect(src).toMatch(/onPolymarketMarketQuote/);
    expect(src).not.toMatch(/startPolymarketMarketWs/);
    expect(src).not.toMatch(/export \{[\s\S]*setPolymarketSportAssetIds/);
    expect(src).not.toMatch(/export \{[\s\S]*extractPolymarketWsBestAsks/);
  });

  test("WS quote path writes fo only; Index sync may refreshOddsOnBets", () => {
    const src = readFileSync(join(root, "../../polymarket/markets/collect.ts"), "utf8");
    const quoteStart = src.indexOf("function updateBetFromAsset");
    const quoteEnd = src.indexOf("const unQuote", quoteStart);
    expect(quoteStart).toBeGreaterThanOrEqual(0);
    expect(quoteEnd).toBeGreaterThan(quoteStart);
    const quoteBody = src.slice(quoteStart, quoteEnd);
    expect(quoteBody).toMatch(/saveTokenQuote\(/);
    expect(quoteBody).not.toMatch(/refreshOddsOnBets/);

    const indexStart = src.indexOf("async function syncMarketIndex");
    expect(indexStart).toBeGreaterThanOrEqual(0);
    expect(src.slice(indexStart)).toMatch(/refreshOddsOnBets\(/);

    const quoteMod = readFileSync(join(root, "../../polymarket/quotes/pmTokenQuote.ts"), "utf8");
    expect(quoteMod).toMatch(/export function saveTokenQuote\(/);
  });

  test("hub layer never imports oddsAccess", () => {
    const hub = readFileSync(join(root, "../../polymarket/marketQuoteHub.ts"), "utf8");
    expect(hub).toMatch(/export function registerPolymarketQuoteAssets\(/);
    expect(hub).not.toMatch(/oddsAccess/);
    expect(hub).not.toMatch(/saveVenueOdds/);
  });
});
