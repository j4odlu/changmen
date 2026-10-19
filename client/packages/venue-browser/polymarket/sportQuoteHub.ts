/**
 * Polymarket 体育 MARKET 行情总线（独立进程 / 独立浏览器 WS）。
 * - 连 `/esport/ws-forward/PM-SPORT-MARKET`（`startPolymarketSportMarketWs`）
 * - 不写 fo；不与电竞 `marketQuoteHub` 合并订阅
 */

import { polymarketMarketSubscribeMessage } from "./api";
import { startPolymarketSportMarketWs, type PolymarketSportMarketWsHandle } from "./sportMarketWs";
import { extractPolymarketWsBestAsks } from "./wsQuotes";
import { shouldApplyPolymarketWsQuote } from "./liveQuoteState";

export interface PolymarketSportQuote {
  assetId: string;
  bestAsk: number;
}

type QuoteListener = (quote: PolymarketSportQuote) => void;
type ReadyListener = () => void;

const subscribed = new Set<string>();
const quoteListeners = new Set<QuoteListener>();
const readyListeners = new Set<ReadyListener>();

let wsHandle: PolymarketSportMarketWsHandle | null = null;
let readyEpoch = 0;
/** 体育板会话保活：无 token 时仍连 hub，供 PM-S 角标反映真实连通 */
let sessionKeepAlive = false;

function sameIdSet(prev: Set<string>, next: string[]): boolean {
  const cleaned = [...new Set(next.map(id => String(id || "").trim()).filter(Boolean))];
  if (cleaned.length !== prev.size)
    return false;
  for (const id of cleaned) {
    if (!prev.has(id))
      return false;
  }
  return true;
}

function resubscribe(initialDump: boolean): void {
  if (!wsHandle)
    return;
  const assetIds = [...subscribed];
  if (assetIds.length)
    wsHandle.send(polymarketMarketSubscribeMessage(assetIds, initialDump));
}

function emitQuote(assetId: string, bestAsk: number): void {
  if (!quoteListeners.size)
    return;
  if (!Number.isFinite(bestAsk) || bestAsk <= 0 || bestAsk >= 1)
    return;
  if (!subscribed.has(assetId))
    return;
  const quote = { assetId, bestAsk };
  for (const fn of quoteListeners) {
    try {
      fn(quote);
    }
    catch (err) {
      console.warn("[Polymarket Sport] market quote listener", err);
    }
  }
}

function notifyReady(): void {
  for (const fn of readyListeners) {
    try {
      fn();
    }
    catch (err) {
      console.warn("[Polymarket Sport] market hub ready listener", err);
    }
  }
}

function maybeStopTransport(): void {
  if (subscribed.size > 0 || sessionKeepAlive)
    return;
  if (!wsHandle)
    return;
  wsHandle.stop();
  wsHandle = null;
  readyEpoch += 1;
}

function ensureSportMarketQuoteHub(): void {
  if (wsHandle)
    return;
  wsHandle = startPolymarketSportMarketWs({
    onOpen: () => resubscribe(true),
    onMessage: (raw) => {
      for (const update of extractPolymarketWsBestAsks(raw)) {
        const price = Number(update.bestAsk);
        if (!Number.isFinite(price))
          continue;
        if (!shouldApplyPolymarketWsQuote(update.assetId, update.timestamp))
          continue;
        emitQuote(update.assetId, price);
      }
    },
  });
  readyEpoch += 1;
  const epoch = readyEpoch;
  queueMicrotask(() => {
    if (epoch !== readyEpoch)
      return;
    notifyReady();
  });
}

/** 体育板挂载：立刻建连（哪怕暂无 token），角标才能反映 hub 通断 */
export function ensurePolymarketSportMarketConnection(): void {
  sessionKeepAlive = true;
  ensureSportMarketQuoteHub();
}

export function getPolymarketSportAssetIds(): string[] {
  return [...subscribed];
}

/** @param force transport 重建后强制重订 */
export function setPolymarketSportAssetIds(assetIds: string[], force = false): void {
  const next = new Set<string>();
  for (const id of assetIds) {
    const s = String(id || "").trim();
    if (s)
      next.add(s);
  }
  if (next.size === 0) {
    if (subscribed.size === 0)
      return;
    subscribed.clear();
    maybeStopTransport();
    return;
  }
  const hadTransport = Boolean(wsHandle);
  const wasEmpty = subscribed.size === 0;
  if (!force && sameIdSet(subscribed, assetIds))
    return;
  ensureSportMarketQuoteHub();
  subscribed.clear();
  for (const id of next)
    subscribed.add(id);
  // 首次有订阅且 transport 已在跑：打一次 initialDump
  resubscribe(hadTransport && wasEmpty);
}

/** 板子会话：hub (re)start 后 force sync */
export function onPolymarketSportHubBound(fn: () => void): () => void {
  readyListeners.add(fn);
  return () => {
    readyListeners.delete(fn);
  };
}

export function onPolymarketSportQuote(fn: (quote: PolymarketSportQuote) => void): () => void {
  quoteListeners.add(fn);
  return () => {
    quoteListeners.delete(fn);
  };
}

/** 关 Tab / 测例：停体育 transport（不影响电竞 marketQuoteHub） */
export function clearPolymarketSportHub(): void {
  sessionKeepAlive = false;
  subscribed.clear();
  maybeStopTransport();
}

/** @internal vitest */
export function __testPushPolymarketSportQuote(assetId: string, bestAsk: number): void {
  emitQuote(assetId, bestAsk);
}

/** @internal vitest */
export function __testResetPolymarketSportQuoteHub(): void {
  sessionKeepAlive = false;
  subscribed.clear();
  quoteListeners.clear();
  readyListeners.clear();
  maybeStopTransport();
}
