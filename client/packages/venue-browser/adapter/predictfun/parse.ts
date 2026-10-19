/**
 * PredictFun 浏览器侧 **报价工具**（非 discovery）。
 *
 * - **Discovery / 映射权威**：`server/collectors/predictfun-collector/parse.js`
 *   （categories → platform_* + MarketIndex）。浏览器 `collect.ts` 只吃 Index + Market WS → fo。
 * - **本文件职责**：decimalOdds、官方 Yes book → token 买价
 *   （`getPredictComplement` / `predictBuyAskFromYesBook` / `buildPredictFunBookMeta`），
 *   供 `marketQuoteHub` / `collect` 种子与实时价使用。
 * - 禁止在此恢复 `buildPredictMappedMarket`（防双源回潮）。
 */
import type { CollectBetDto, CollectMatchDto } from "@changmen/client-core/types/collect";
import { truncateOddsTo3 } from "@changmen/shared/odds_format";

export type PredictOrderbookLevel = [number, number];

export interface PredictOrderbookData {
  marketId?: number;
  updateTimestampMs?: number;
  asks?: PredictOrderbookLevel[];
  bids?: PredictOrderbookLevel[];
}

/** 单 market 的 Yes book → token 买价映射（对齐官方 orderbook + getComplement） */
export interface PredictFunBookMeta {
  decimalPrecision: number;
  tokens: Array<{ tokenId: string; isYes: boolean }>;
}

/**
 * Index / 运行时 DTO 形状（非 categories 扫盘产物）。
 * `marketIndex.indexEntryToMappedMarket` 从此构造。
 */
export interface PredictMappedMarket {
  match: CollectMatchDto;
  /** 全场或首条，兼容旧调用方 */
  bet: CollectBetDto;
  /** 全场 + Game N 局盘 */
  bets: CollectBetDto[];
  homeMarketId: string;
  awayMarketId: string;
  homeTokenId: string;
  awayTokenId: string;
  categoryId: string;
  marketIds?: string[];
  /** marketId → Yes token / precision；供 Index 与 hub 拆两侧买价 */
  bookMetaByMarketId?: Record<string, { yesTokenId: string; decimalPrecision: number }>;
}

export function decimalOddsFromProbability(price: string | number | undefined): number {
  const value = Number(price);
  if (!Number.isFinite(value) || value <= 0 || value >= 1)
    return 0;
  return truncateOddsTo3(1 / value);
}

/** [Predict 官方] orderbook asks/bids 为 [price, size] 元组，Yes 侧 best ask 在 asks[0] */
export function bestAskFromPredictBook(book: PredictOrderbookData | undefined): number {
  const asks = book?.asks ?? [];
  const first = asks[0];
  if (Array.isArray(first)) {
    const price = Number(first[0]);
    const size = Number(first[1]);
    if (Number.isFinite(price) && price > 0 && price < 1 && (!Number.isFinite(size) || size > 0))
      return price;
  }
  let best = Number.POSITIVE_INFINITY;
  for (const level of asks) {
    if (!Array.isArray(level))
      continue;
    const price = Number(level[0]);
    const size = Number(level[1]);
    if (Number.isFinite(price) && price > 0 && price < best && (!Number.isFinite(size) || size > 0))
      best = price;
  }
  return Number.isFinite(best) && best < 1 ? best : 0;
}

/** [Predict 官方] Yes 侧 best bid 在 bids[0] */
export function bestBidFromPredictBook(book: PredictOrderbookData | undefined): number {
  const bids = book?.bids ?? [];
  const first = bids[0];
  if (Array.isArray(first)) {
    const price = Number(first[0]);
    const size = Number(first[1]);
    if (Number.isFinite(price) && price > 0 && price < 1 && (!Number.isFinite(size) || size > 0))
      return price;
  }
  let best = 0;
  for (const level of bids) {
    if (!Array.isArray(level))
      continue;
    const price = Number(level[0]);
    const size = Number(level[1]);
    if (Number.isFinite(price) && price > best && price < 1 && (!Number.isFinite(size) || size > 0))
      best = price;
  }
  return best > 0 ? best : 0;
}

/**
 * [Predict 官方] Yes + No = 1（按 market.decimalPrecision 取整）；禁止裸 `1 - price`。
 * @see https://dev.predict.fun/understanding-the-orderbook-685654m0
 */
export function getPredictComplement(price: number, decimalPrecision = 2): number {
  const precision = Number.isFinite(decimalPrecision) && decimalPrecision >= 0
    ? Math.floor(Number(decimalPrecision))
    : 2;
  const factor = 10 ** precision;
  const raw = Number(price);
  if (!Number.isFinite(raw))
    return NaN;
  return (factor - Math.round(raw * factor)) / factor;
}

function normalizeBookLevels(levels: PredictOrderbookLevel[] | undefined): PredictOrderbookLevel[] {
  const out: PredictOrderbookLevel[] = [];
  for (const level of levels ?? []) {
    if (!Array.isArray(level))
      continue;
    const price = Number(level[0]);
    const size = Number(level[1]);
    if (!Number.isFinite(price) || price <= 0 || price >= 1)
      continue;
    if (!Number.isFinite(size) || size <= 0)
      continue;
    out.push([price, size]);
  }
  return out;
}

function sortAsksAsc(levels: PredictOrderbookLevel[]): PredictOrderbookLevel[] {
  return [...levels].sort((a, b) => a[0] - b[0]);
}

function sortBidsDesc(levels: PredictOrderbookLevel[]): PredictOrderbookLevel[] {
  return [...levels].sort((a, b) => b[0] - a[0]);
}

/**
 * [Predict 官方] GET orderbook 只含 Yes；买 No 须交换并 getComplement 各档。
 * SDK getMarketOrderAmounts(BUY) 直接吃传入的 asks，不会自动补全。
 */
export function orderbookForOutcomeBuy(
  yesBook: PredictOrderbookData | null | undefined,
  opts: {
    isYesOutcome: boolean;
    decimalPrecision?: number;
  },
): PredictOrderbookData {
  const yesAsks = normalizeBookLevels(yesBook?.asks);
  const yesBids = normalizeBookLevels(yesBook?.bids);
  if (opts.isYesOutcome) {
    return {
      marketId: yesBook?.marketId,
      updateTimestampMs: yesBook?.updateTimestampMs,
      asks: sortAsksAsc(yesAsks),
      bids: sortBidsDesc(yesBids),
    };
  }
  const precision = Number.isFinite(opts.decimalPrecision)
    ? Number(opts.decimalPrecision)
    : 2;
  const noAsks = yesBids.map(([p, q]) => [getPredictComplement(p, precision), q] as PredictOrderbookLevel);
  const noBids = yesAsks.map(([p, q]) => [getPredictComplement(p, precision), q] as PredictOrderbookLevel);
  return {
    marketId: yesBook?.marketId,
    updateTimestampMs: yesBook?.updateTimestampMs,
    asks: sortAsksAsc(normalizeBookLevels(noAsks)),
    bids: sortBidsDesc(normalizeBookLevels(noBids)),
  };
}

/** 买该 outcome 的 best ask（Yes=asks[0]；No=complement(bids) 后 asks[0]） */
export function predictBuyAskFromYesBook(
  yesBook: PredictOrderbookData | null | undefined,
  isYesOutcome: boolean,
  decimalPrecision = 2,
): number {
  return bestAskFromPredictBook(orderbookForOutcomeBuy(yesBook, {
    isYesOutcome,
    decimalPrecision,
  }));
}

/** 从 Index/映射登记 hub 用的 book→token 元数据 */
export function buildPredictFunBookMeta(opts: {
  homeTokenId: string;
  awayTokenId: string;
  yesTokenId?: string;
  decimalPrecision?: number;
  /** 同 market 双 outcome；false=每队一盘，只写该盘 Yes token */
  dualOutcomeSameMarket: boolean;
  /** 双盘时本 meta 只绑定的一侧 token */
  sideTokenId?: string;
}): PredictFunBookMeta {
  const precision = Number.isFinite(opts.decimalPrecision)
    ? Math.floor(Number(opts.decimalPrecision))
    : 2;
  const home = String(opts.homeTokenId || "").trim();
  const away = String(opts.awayTokenId || "").trim();
  if (!opts.dualOutcomeSameMarket) {
    const tok = String(opts.sideTokenId || home || away).trim();
    return {
      decimalPrecision: precision >= 0 ? precision : 2,
      tokens: tok ? [{ tokenId: tok, isYes: true }] : [],
    };
  }
  const yesTok = String(opts.yesTokenId || "").trim();
  // 单盘双 outcome 必须有 yesTokenId，否则无法判断谁吃 Yes book；宁可不展开
  if (!yesTok) {
    return {
      decimalPrecision: precision >= 0 ? precision : 2,
      tokens: [],
    };
  }
  const tokens: PredictFunBookMeta["tokens"] = [];
  if (home)
    tokens.push({ tokenId: home, isYes: home === yesTok });
  if (away && away !== home)
    tokens.push({ tokenId: away, isYes: away === yesTok });
  return {
    decimalPrecision: precision >= 0 ? precision : 2,
    tokens,
  };
}
