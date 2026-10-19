/**
 * PredictFun orderbook 行情总线（数据源层）。
 * - 只负责：连接、合并多消费者订阅、广播 quote
 * - 不知道电竞/体育；不写 fo
 *
 * 对外两路（互不影响）：
 * - market quote `{ marketId, bestAsk }`：Yes 侧 ask（体育等沿用）
 * - token quote `{ tokenId, bestAsk }`：官方 Yes book 展开后的可买价（电竞对齐 PM）
 */

import {
  bestAskFromPredictBook,
  predictBuyAskFromYesBook,
  type PredictFunBookMeta,
  type PredictOrderbookData,
} from "./parse";
import {
  cyclePfMarketWsSourceMode,
  type PfMarketWsSourceMode,
} from "./pfMarketWsMode";
import { startPredictMarketWs, type PredictMarketWsHandle } from "./ws";

export interface PredictFunMarketQuote {
  marketId: string;
  bestAsk: number;
}

/** 与 Polymarket `{ assetId, bestAsk }` 同形 */
export interface PredictFunTokenQuote {
  tokenId: string;
  bestAsk: number;
}

export type PredictFunQuoteConsumerId = "esport" | "sport" | (string & {});

type QuoteListener = (quote: PredictFunMarketQuote) => void;
type TokenQuoteListener = (quote: PredictFunTokenQuote) => void;
type ReadyListener = () => void;

const consumers = new Map<string, Set<string>>();
const quoteListeners = new Set<QuoteListener>();
const tokenQuoteListeners = new Set<TokenQuoteListener>();
const readyListeners = new Set<ReadyListener>();
/** marketId → 拆 token 元数据（仅电竞登记；体育不登记则只收 market quote） */
const bookMetas = new Map<string, PredictFunBookMeta>();

let wsHandle: PredictMarketWsHandle | null = null;
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

function mergedMarketIds(): string[] {
  const all = new Set<string>();
  for (const set of consumers.values()) {
    for (const id of set)
      all.add(id);
  }
  return [...all];
}

function resubscribe(): void {
  if (!wsHandle)
    return;
  wsHandle.subscribeMarketIds(mergedMarketIds());
}

function emitQuote(marketId: string, bestAsk: number): void {
  if (!quoteListeners.size)
    return;
  if (!Number.isFinite(bestAsk) || bestAsk <= 0 || bestAsk >= 1)
    return;
  const quote = { marketId, bestAsk };
  for (const fn of quoteListeners) {
    try {
      fn(quote);
    }
    catch (err) {
      console.warn("[PredictFun] market quote listener", err);
    }
  }
}

function emitTokenQuote(tokenId: string, bestAsk: number): void {
  if (!tokenQuoteListeners.size)
    return;
  const id = String(tokenId || "").trim();
  if (!id)
    return;
  if (!Number.isFinite(bestAsk) || bestAsk <= 0 || bestAsk >= 1)
    return;
  const quote = { tokenId: id, bestAsk };
  for (const fn of tokenQuoteListeners) {
    try {
      fn(quote);
    }
    catch (err) {
      console.warn("[PredictFun] token quote listener", err);
    }
  }
}

function expandOrderbookToTokenQuotes(
  marketId: string,
  orderbook: PredictOrderbookData | undefined,
): void {
  if (!tokenQuoteListeners.size)
    return;
  const meta = bookMetas.get(marketId);
  if (!meta?.tokens?.length)
    return;
  const precision = meta.decimalPrecision;
  const yesAsk = predictBuyAskFromYesBook(orderbook, true, precision);
  const noAsk = predictBuyAskFromYesBook(orderbook, false, precision);
  for (const tok of meta.tokens) {
    const ask = tok.isYes ? yesAsk : noAsk;
    if (ask > 0)
      emitTokenQuote(tok.tokenId, ask);
  }
}

function notifyReady(): void {
  for (const fn of readyListeners) {
    try {
      fn();
    }
    catch (err) {
      console.warn("[PredictFun] market hub ready listener", err);
    }
  }
}

function maybeStopTransport(): void {
  if (consumers.size > 0)
    return;
  if (!wsHandle)
    return;
  wsHandle.stop();
  wsHandle = null;
  readyEpoch += 1;
}

export function ensurePredictFunMarketQuoteHub(): void {
  if (wsHandle)
    return;
  wsHandle = startPredictMarketWs({
    onOrderbook: (update) => {
      const marketId = String(update.marketId ?? "");
      if (!marketId)
        return;
      const orderbook = update.orderbook;
      const yesAsk = bestAskFromPredictBook(orderbook);
      // 体育等：仍只推 Yes ask（接口不变）
      if (yesAsk > 0)
        emitQuote(marketId, yesAsk);
      // 电竞：有 bookMeta 时展开为 token 买价（对齐 PM asset quote）
      expandOrderbookToTokenQuotes(marketId, orderbook);
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

export function registerPredictFunQuoteMarkets(
  consumerId: PredictFunQuoteConsumerId,
  marketIds: string[],
  force = false,
): void {
  const key = String(consumerId || "").trim() || "anon";
  const next = new Set<string>();
  for (const id of marketIds) {
    const s = String(id || "").trim();
    if (s)
      next.add(s);
  }
  if (next.size === 0) {
    if (!consumers.has(key))
      return;
    consumers.delete(key);
    if (key === "esport")
      clearPredictFunBookMetas();
    if (consumers.size > 0)
      resubscribe();
    else
      maybeStopTransport();
    return;
  }
  ensurePredictFunMarketQuoteHub();
  const prev = consumers.get(key) ?? new Set<string>();
  if (!force && sameIdSet(prev, marketIds))
    return;
  consumers.set(key, next);
  resubscribe();
}

/**
 * 登记 marketId → token 买价展开表（整表替换）。
 * 仅电竞 collect 调用；不登记则不发 token quote，体育不受影响。
 */
export function registerPredictFunBookMetas(
  metas: Iterable<[string, PredictFunBookMeta]> | Map<string, PredictFunBookMeta>,
): void {
  bookMetas.clear();
  for (const [rawId, meta] of metas) {
    const marketId = String(rawId || "").trim();
    if (!marketId || !meta?.tokens?.length)
      continue;
    const tokens = [];
    for (const t of meta.tokens) {
      const tokenId = String(t.tokenId || "").trim();
      if (!tokenId)
        continue;
      tokens.push({ tokenId, isYes: Boolean(t.isYes) });
    }
    if (!tokens.length)
      continue;
    const precision = Number(meta.decimalPrecision);
    bookMetas.set(marketId, {
      decimalPrecision: Number.isFinite(precision) && precision >= 0 ? Math.floor(precision) : 2,
      tokens,
    });
  }
}

export function clearPredictFunBookMetas(): void {
  bookMetas.clear();
}

export function unregisterPredictFunQuoteConsumer(consumerId: PredictFunQuoteConsumerId): void {
  const key = String(consumerId || "").trim() || "anon";
  if (!consumers.has(key))
    return;
  consumers.delete(key);
  if (key === "esport")
    clearPredictFunBookMetas();
  if (consumers.size > 0)
    resubscribe();
  else
    maybeStopTransport();
}

/** 角标切换 official/changmen 后重建 WS，保留已有订阅 */
export function cyclePredictFunMarketWsSourceModeAndReconnect(): PfMarketWsSourceMode {
  const next = cyclePfMarketWsSourceMode();
  if (!wsHandle)
    return next;
  wsHandle.stop();
  wsHandle = null;
  readyEpoch += 1;
  ensurePredictFunMarketQuoteHub();
  resubscribe();
  return next;
}

export function onPredictFunMarketQuote(fn: QuoteListener): () => void {
  quoteListeners.add(fn);
  return () => {
    quoteListeners.delete(fn);
  };
}

/** 电竞 fo：与 PM onPolymarketMarketQuote 同形 */
export function onPredictFunTokenQuote(fn: TokenQuoteListener): () => void {
  tokenQuoteListeners.add(fn);
  return () => {
    tokenQuoteListeners.delete(fn);
  };
}

export function onPredictFunMarketHubReady(fn: ReadyListener): () => void {
  readyListeners.add(fn);
  return () => {
    readyListeners.delete(fn);
  };
}

export function getPredictFunQuoteConsumerMarketIds(consumerId: PredictFunQuoteConsumerId): string[] {
  const set = consumers.get(String(consumerId || "").trim() || "anon");
  return set ? [...set] : [];
}

/** O(1) 查询；体育热路径过滤用 */
export function hasPredictFunQuoteConsumerMarket(
  consumerId: PredictFunQuoteConsumerId,
  marketId: string,
): boolean {
  const id = String(marketId || "").trim();
  if (!id)
    return false;
  return consumers.get(String(consumerId || "").trim() || "anon")?.has(id) ?? false;
}

/** @internal vitest */
export function __testPushPredictFunMarketQuote(marketId: string, bestAsk: number): void {
  emitQuote(marketId, bestAsk);
}

/** @internal vitest */
export function __testPushPredictFunTokenQuote(tokenId: string, bestAsk: number): void {
  emitTokenQuote(tokenId, bestAsk);
}

/** @internal vitest */
export function __testResetPredictFunMarketQuoteHub(): void {
  consumers.clear();
  quoteListeners.clear();
  tokenQuoteListeners.clear();
  readyListeners.clear();
  bookMetas.clear();
  maybeStopTransport();
}
