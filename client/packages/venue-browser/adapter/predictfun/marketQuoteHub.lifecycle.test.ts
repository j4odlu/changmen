/**
 * PF marketQuoteHub 生命周期契约（热路径闸门）。
 * 改 hub / collect 启停 / 同集重订 / unsubscribe 前：本文件必须绿。
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  __testPushPredictFunMarketQuote,
  __testResetPredictFunMarketQuoteHub,
  getPredictFunQuoteConsumerMarketIds,
  onPredictFunMarketQuote,
  onPredictFunTokenQuote,
  registerPredictFunBookMetas,
  registerPredictFunQuoteMarkets,
  unregisterPredictFunQuoteConsumer,
} from "./marketQuoteHub";
import {
  clearPredictFunSportHub,
  onPredictFunSportQuote,
  setPredictFunSportMarketIds,
} from "./sportQuoteHub";

const root = dirname(fileURLToPath(import.meta.url));

afterEach(() => {
  __testResetPredictFunMarketQuoteHub();
  vi.restoreAllMocks();
});

async function mockPfWs() {
  const ws = await import("./ws");
  const subscribeMarketIds = vi.fn();
  const stop = vi.fn();
  const startSpy = vi.spyOn(ws, "startPredictMarketWs").mockReturnValue({
    subscribeMarketIds,
    stop,
  } as any);
  return { subscribeMarketIds, stop, startSpy };
}

describe("PF marketQuoteHub lifecycle contracts", () => {
  test("force=true resubscribes even when market set unchanged (hub ready / transport rebuild)", async () => {
    const { subscribeMarketIds } = await mockPfWs();
    registerPredictFunQuoteMarkets("esport", ["m1", "m2"]);
    expect(subscribeMarketIds).toHaveBeenCalledTimes(1);
    registerPredictFunQuoteMarkets("esport", ["m2", "m1"], true);
    expect(subscribeMarketIds).toHaveBeenCalledTimes(2);
  });

  test("same market set without force does not resubscribe", async () => {
    const { subscribeMarketIds } = await mockPfWs();
    registerPredictFunQuoteMarkets("esport", ["m1", "m2"]);
    expect(subscribeMarketIds).toHaveBeenCalledTimes(1);
    registerPredictFunQuoteMarkets("esport", ["m2", "m1"]);
    expect(subscribeMarketIds).toHaveBeenCalledTimes(1);
  });

  test("unregister esport keeps transport when sport still registered", async () => {
    const { stop, subscribeMarketIds } = await mockPfWs();
    registerPredictFunQuoteMarkets("esport", ["e1"]);
    registerPredictFunQuoteMarkets("sport", ["s1"]);
    unregisterPredictFunQuoteConsumer("esport");
    expect(stop).not.toHaveBeenCalled();
    expect(getPredictFunQuoteConsumerMarketIds("sport")).toEqual(["s1"]);
    const last = subscribeMarketIds.mock.calls.at(-1)?.[0] as string[];
    expect(last).toEqual(["s1"]);
  });

  test("last consumer unregister stops transport", async () => {
    const { stop } = await mockPfWs();
    registerPredictFunQuoteMarkets("esport", ["e1"]);
    unregisterPredictFunQuoteConsumer("esport");
    expect(stop).toHaveBeenCalledTimes(1);
  });

  test("collector-restart pattern: unregister then re-register rejoins sport hub", async () => {
    const { stop, subscribeMarketIds } = await mockPfWs();
    registerPredictFunQuoteMarkets("sport", ["s1"]);
    registerPredictFunQuoteMarkets("esport", ["e1"]);
    unregisterPredictFunQuoteConsumer("esport");
    expect(stop).not.toHaveBeenCalled();
    subscribeMarketIds.mockClear();
    registerPredictFunQuoteMarkets("esport", ["e1"]);
    expect(subscribeMarketIds).toHaveBeenCalledTimes(1);
    expect(getPredictFunQuoteConsumerMarketIds("sport")).toEqual(["s1"]);
  });

  test("sport compat Set.has filter", () => {
    setPredictFunSportMarketIds(["m1"]);
    const seen: string[] = [];
    const un = onPredictFunSportQuote(q => seen.push(q.marketId));
    __testPushPredictFunMarketQuote("m1", 0.4);
    __testPushPredictFunMarketQuote("other", 0.5);
    expect(seen).toEqual(["m1"]);
    un();
    clearPredictFunSportHub();
  });

  test("token quote path does not change market quote sport API", async () => {
    const { startSpy } = await mockPfWs();
    const marketSeen: string[] = [];
    const tokenSeen: string[] = [];
    const unM = onPredictFunMarketQuote(q => marketSeen.push(`${q.marketId}:${q.bestAsk}`));
    const unT = onPredictFunTokenQuote(q => tokenSeen.push(`${q.tokenId}:${q.bestAsk}`));

    registerPredictFunQuoteMarkets("esport", ["m1"]);
    registerPredictFunBookMetas(new Map([
      ["m1", {
        decimalPrecision: 2,
        tokens: [
          { tokenId: "tok-yes", isYes: true },
          { tokenId: "tok-no", isYes: false },
        ],
      }],
    ]));

    const onOrderbook = startSpy.mock.calls[0]?.[0]?.onOrderbook as (u: {
      marketId: string;
      orderbook: { asks: [number, number][]; bids: [number, number][] };
    }) => void;
    onOrderbook({
      marketId: "m1",
      orderbook: {
        asks: [[0.18, 200]],
        bids: [[0.16, 200]],
      },
    });

    expect(marketSeen).toEqual(["m1:0.18"]);
    expect(tokenSeen.sort()).toEqual(["tok-no:0.84", "tok-yes:0.18"]);
    unM();
    unT();
  });

  test("simulated esport fo filter: prune mapping stops saveVenueOdds", async () => {
    const oddsAccess = await import("@changmen/client-core/bridge/oddsAccess");
    const spy = vi.spyOn(oddsAccess, "saveVenueOdds").mockImplementation(() => {});
    const marketIdToCategory = new Map([["eM", "cat1"]]);

    registerPredictFunQuoteMarkets("esport", ["eM", "sM"]);
    const un = onPredictFunMarketQuote((q) => {
      if (!marketIdToCategory.has(q.marketId))
        return;
      oddsAccess.saveVenueOdds("PredictFun", {
        id: q.marketId,
        odds: 1 / q.bestAsk,
        isLock: false,
        time: Date.now(),
        marketId: q.marketId,
      }, "mqtt");
    });

    __testPushPredictFunMarketQuote("sM", 0.4);
    expect(spy).not.toHaveBeenCalled();
    __testPushPredictFunMarketQuote("eM", 0.5);
    expect(spy).toHaveBeenCalledTimes(1);

    marketIdToCategory.clear();
    __testPushPredictFunMarketQuote("eM", 0.45);
    expect(spy).toHaveBeenCalledTimes(1);
    un();
  });
});

describe("PF ws unsubscribe contract", () => {
  test("subscribeMarketIds unsubscribes removed ids when socket open", async () => {
    const sent: string[] = [];
    const OPEN = 1;
    function WebSocketMock(this: any) {
      this.readyState = OPEN;
      this.send = (raw: string) => {
        sent.push(raw);
      };
      this.close = vi.fn();
      queueMicrotask(() => {
        this.onopen?.();
      });
    }
    WebSocketMock.OPEN = OPEN;
    WebSocketMock.CONNECTING = 0;
    WebSocketMock.CLOSING = 2;
    WebSocketMock.CLOSED = 3;
    vi.stubGlobal("WebSocket", WebSocketMock as any);

    vi.resetModules();
    const { startPredictMarketWs } = await import("./ws");
    const handle = startPredictMarketWs({ onOrderbook: () => {} });
    await Promise.resolve();
    handle.subscribeMarketIds(["a", "b"]);
    expect(sent.some(raw => JSON.parse(raw).method === "subscribe")).toBe(true);
    sent.length = 0;
    handle.subscribeMarketIds(["b"]);
    const methods = sent.map(raw => JSON.parse(raw).method);
    expect(methods).toContain("unsubscribe");
    expect(methods).toContain("subscribe");
    const unsub = sent.map(raw => JSON.parse(raw)).find(m => m.method === "unsubscribe");
    expect(unsub.params[0]).toBe("predictOrderbook/a");
    handle.stop();
    vi.unstubAllGlobals();
  });
});

describe("PF collect / hub source contracts", () => {
  test("collect never SaveMatch/SaveBet (VPS owns platform_*)", () => {
    const src = readFileSync(join(root, "collect.ts"), "utf8");
    expect(src).not.toMatch(/saveBets\s*\(/);
    expect(src).not.toMatch(/\bsaveMatch\s*\(/);
    expect(src).not.toMatch(/saveBetSource/);
    expect(src).not.toMatch(/saveMatchSource/);
    expect(src).not.toMatch(/useCollectStore/);
    expect(src).not.toMatch(/API_SaveBet/);
    expect(src).not.toMatch(/API_SaveMatch/);
  });

  test("collect stop only unregister esport; hub-ready force only; no unchanged-index resub; no sport re-export", () => {
    const src = readFileSync(join(root, "collect.ts"), "utf8");
    expect(src).toMatch(/unregisterPredictFunQuoteConsumer\(QUOTE_CONSUMER\)/);
    expect(src).not.toMatch(/clearPredictFunSportHub/);
    expect(src).toMatch(/onPredictFunMarketHubReady\(\(\) => \{\s*syncEsportMarkets\(true\);/);
    expect(src).toMatch(/if \(index\.updatedAt === lastIndexUpdatedAt\)\s*return;/);
    expect(src).not.toMatch(/updatedAt === lastIndexUpdatedAt\)[\s\S]{0,80}syncEsportMarkets\(true\)/);
    expect(src).toMatch(/onPredictFunTokenQuote/);
    expect(src).not.toMatch(/startPredictMarketWs/);
    expect(src).not.toMatch(/export \{[\s\S]*setPredictFunSportMarketIds/);
  });

  test("WS token quote path writes fo only; Index sync may refreshOddsOnBets", () => {
    const src = readFileSync(join(root, "collect.ts"), "utf8");
    const quoteStart = src.indexOf("function updateBetFromToken");
    const quoteEnd = src.indexOf("const unQuote", quoteStart);
    expect(quoteStart).toBeGreaterThanOrEqual(0);
    expect(quoteEnd).toBeGreaterThan(quoteStart);
    const quoteBody = src.slice(quoteStart, quoteEnd);
    expect(quoteBody).toMatch(/saveTokenQuote\(/);
    expect(quoteBody).not.toMatch(/refreshOddsOnBets/);

    const indexStart = src.indexOf("async function syncMarketIndex");
    expect(indexStart).toBeGreaterThanOrEqual(0);
    expect(src.slice(indexStart)).toMatch(/refreshOddsOnBets\(/);
    expect(src).toMatch(/registerPredictFunBookMetas/);
  });

  test("hub layer never imports oddsAccess", () => {
    const hub = readFileSync(join(root, "marketQuoteHub.ts"), "utf8");
    expect(hub).not.toMatch(/oddsAccess/);
    expect(hub).not.toMatch(/saveVenueOdds/);
  });
});
