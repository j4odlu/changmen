/**
 * Polymarket CLOB market 行情总线（数据源层）。
 * - 只负责：连接、合并多消费者订阅、广播 quote
 * - 不知道电竞/体育；不写 fo；不碰 UI
 *
 * 业务消费者：`registerPolymarketQuoteAssets("esport"|"sport", ids)` + `onPolymarketMarketQuote`
 */

import { polymarketMarketSubscribeMessage } from "./api";
import {
  notePolymarketMarketWsSubscription,
  notePolymarketMarketWsQuote,
  startPolymarketMarketWs,
  type PolymarketMarketWsHandle,
} from "./ws";
import { extractPolymarketWsBestAsks } from "./wsQuotes";
import { shouldApplyPolymarketWsQuote } from "./liveQuoteState";
import { recordPmQuoteToFoMetric } from "./pmExecutionMetrics";

export interface PolymarketMarketQuote {
  assetId: string;
  bestAsk: number;
}

export type PolymarketQuoteConsumerId = "esport" | "sport" | (string & {});

type QuoteListener = (quote: PolymarketMarketQuote) => void;
type ReadyListener = () => void;

const consumers = new Map<string, Set<string>>();
const quoteListeners = new Set<QuoteListener>();
const readyListeners = new Set<ReadyListener>();

let wsHandle: PolymarketMarketWsHandle | null = null;
/** 作废已排队的 ready microtask */
let readyEpoch = 0;

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

function mergedAssetIds(): string[] {
  const all = new Set<string>();
  for (const set of consumers.values()) {
    for (const id of set)
      all.add(id);
  }
  return [...all];
}

function resubscribe(initialDump: boolean): void {
  if (!wsHandle)
    return;
  const assetIds = mergedAssetIds();
  notePolymarketMarketWsSubscription(assetIds.length);
  if (assetIds.length)
    wsHandle.send(polymarketMarketSubscribeMessage(assetIds, initialDump));
}

function emitQuote(assetId: string, bestAsk: number): void {
  if (!quoteListeners.size)
    return;
  if (!Number.isFinite(bestAsk) || bestAsk <= 0 || bestAsk >= 1)
    return;
  const quote = { assetId, bestAsk };
  for (const fn of quoteListeners) {
    try {
      fn(quote);
    }
    catch (err) {
      console.warn("[Polymarket] market quote listener", err);
    }
  }
}

function notifyReady(): void {
  for (const fn of readyListeners) {
    try {
      fn();
    }
    catch (err) {
      console.warn("[Polymarket] market hub ready listener", err);
    }
  }
}

function maybeStopTransport(): void {
  if (consumers.size > 0)
    return;
  notePolymarketMarketWsSubscription(0);
  if (!wsHandle)
    return;
  wsHandle.stop();
  wsHandle = null;
  readyEpoch += 1;
}

/** 停掉 market quote transport；logout / session teardown 使用。 */
export function stopPolymarketMarketQuoteHub(): void {
  consumers.clear();
  notePolymarketMarketWsSubscription(0);
  if (!wsHandle)
    return;
  wsHandle.stop();
  wsHandle = null;
  readyEpoch += 1;
}

/** 确保行情 WS 在跑（幂等）。 */
export function ensurePolymarketMarketQuoteHub(): void {
  if (wsHandle)
    return;
  wsHandle = startPolymarketMarketWs({
    onOpen: () => resubscribe(true),
    onMessage: (raw) => {
      for (const update of extractPolymarketWsBestAsks(raw)) {
        const price = Number(update.bestAsk);
        if (!Number.isFinite(price))
          continue;
        if (!shouldApplyPolymarketWsQuote(update.assetId, update.timestamp)) {
          recordPmQuoteToFoMetric({
            tokenId: update.assetId,
            quotePrice: price,
            quoteSource: "ws",
            success: false,
            rejectReason: "stale_ws_guard",
          });
          continue;
        }
        notePolymarketMarketWsQuote(update.timestamp);
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

/**
 * 业务层登记本消费者要订的 CLOB token。
 * @param force 跳过同集合短路（transport 重建后强制重订）
 */
export function registerPolymarketQuoteAssets(
  consumerId: PolymarketQuoteConsumerId,
  assetIds: string[],
  force = false,
): void {
  const key = String(consumerId || "").trim() || "anon";
  const next = new Set<string>();
  for (const id of assetIds) {
    const s = String(id || "").trim();
    if (s)
      next.add(s);
  }
  if (next.size === 0) {
    if (!consumers.has(key))
      return;
    consumers.delete(key);
    if (consumers.size > 0)
      resubscribe(false);
    else
      maybeStopTransport();
    return;
  }
  const hadTransport = Boolean(wsHandle);
  ensurePolymarketMarketQuoteHub();
  const prev = consumers.get(key) ?? new Set<string>();
  if (!force && sameIdSet(prev, assetIds))
    return;
  // 新 consumer 挂到已在跑的 hub：打一次 initialDump（本 consumer 首次登记）
  const isNewConsumer = !consumers.has(key);
  consumers.set(key, next);
  resubscribe(hadTransport && isNewConsumer);
}

/** 业务层注销消费者（collector stop / 关体育 Tab）。 */
export function unregisterPolymarketQuoteConsumer(consumerId: PolymarketQuoteConsumerId): void {
  const key = String(consumerId || "").trim() || "anon";
  if (!consumers.has(key))
    return;
  consumers.delete(key);
  if (consumers.size > 0)
    resubscribe(false);
  else
    maybeStopTransport();
}

export function onPolymarketMarketQuote(fn: QuoteListener): () => void {
  quoteListeners.add(fn);
  return () => {
    quoteListeners.delete(fn);
  };
}

/** transport (re)start 后通知业务重登记（例如体育 sync(true)）。 */
export function onPolymarketMarketHubReady(fn: ReadyListener): () => void {
  readyListeners.add(fn);
  return () => {
    readyListeners.delete(fn);
  };
}

export function getPolymarketQuoteConsumerAssetIds(consumerId: PolymarketQuoteConsumerId): string[] {
  const set = consumers.get(String(consumerId || "").trim() || "anon");
  return set ? [...set] : [];
}

/** O(1) 查询；体育热路径过滤用，避免每帧拷贝数组 + includes */
export function hasPolymarketQuoteConsumerAsset(
  consumerId: PolymarketQuoteConsumerId,
  assetId: string,
): boolean {
  const id = String(assetId || "").trim();
  if (!id)
    return false;
  return consumers.get(String(consumerId || "").trim() || "anon")?.has(id) ?? false;
}

/** @internal vitest */
export function __testPushPolymarketMarketQuote(assetId: string, bestAsk: number): void {
  emitQuote(assetId, bestAsk);
}

/** @internal vitest — 拆掉全部消费者并停 transport */
export function __testResetPolymarketMarketQuoteHub(): void {
  consumers.clear();
  quoteListeners.clear();
  readyListeners.clear();
  stopPolymarketMarketQuoteHub();
}
