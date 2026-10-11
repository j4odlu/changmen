/**
 * PM 写 fo 的唯一入口（采集 WS + 预检 book 纠偏共用）。
 */
import type { BetOption } from "@changmen/client-core/models/betOption";
import { getVenueOddsEntry, saveVenueOdds } from "@changmen/client-core/bridge/oddsAccess";
import { PLATFORMS } from "../../shared/platforms";
import { decimalOddsFromProbability } from "../parse";
import { isValidClobPrice } from "../pmDetection";
import { recordPmQuoteToFoMetric, type PmQuoteSource } from "../pmExecutionMetrics";

const PLATFORM = PLATFORMS.Polymarket;

/** PM 写 fo：decimal odds 供展示/套利，clobPrice 供预检限价 */
export function saveTokenQuote(
  params: {
    tokenId: string;
    clobPrice: number;
    betId: string;
    side: "home" | "away";
    locked: boolean;
  },
  source: "http" | "mqtt",
  metricSource: PmQuoteSource = source === "mqtt" ? "ws" : "http-seed",
) {
  saveVenueOdds(PLATFORM, {
    id: params.tokenId,
    odds: decimalOddsFromProbability(params.clobPrice),
    clobPrice: params.clobPrice,
    isLock: params.locked,
    betId: params.betId,
    side: params.side,
    time: Date.now(),
  }, source);
  recordPmQuoteToFoMetric({
    tokenId: params.tokenId,
    betId: params.betId,
    side: params.side,
    quotePrice: params.clobPrice,
    quoteSource: metricSource,
    success: true,
  });
}

/** 预检/下单：book best ask 高于检测限价时抛出，便于 catch 回写 fo */
export class PolymarketPriceAboveDetectionError extends Error {
  readonly bestAskPrice: number;
  readonly detectionMaxPrice: number;

  constructor(message: string, bestAskPrice: number, detectionMaxPrice: number) {
    super(message);
    this.name = "PolymarketPriceAboveDetectionError";
    this.bestAskPrice = bestAskPrice;
    this.detectionMaxPrice = detectionMaxPrice;
  }
}

export function isPolymarketPriceAboveDetectionError(
  err: unknown,
): err is PolymarketPriceAboveDetectionError {
  return err instanceof PolymarketPriceAboveDetectionError;
}

/**
 * 「盘口价高于检测价」时用 book best ask 纠偏 fo，打断过期便宜价反复触发套利。
 * 仅允许 fo 往更贵（买方更差）方向更新；不改 detection 限价。
 */
export function syncPolymarketFoOnPriceAboveDetection(
  option: BetOption,
  err: PolymarketPriceAboveDetectionError,
): void {
  const bestAsk = err.bestAskPrice;
  const maxPrice = err.detectionMaxPrice;
  if (!isValidClobPrice(bestAsk) || !(bestAsk > maxPrice + 1e-9))
    return;
  const tokenId = String(option.itemId ?? "").trim();
  if (!tokenId)
    return;
  const prev = getVenueOddsEntry(PLATFORM, tokenId);
  const prevClob = Number(prev?.clobPrice);
  if (isValidClobPrice(prevClob) && !(bestAsk > prevClob + 1e-9))
    return;
  const side = prev?.side === "home" || prev?.side === "away"
    ? prev.side
    : (option.target === "Away" ? "away" : "home");
  // 优先保留 fo 已有 betId，避免空字符串覆盖后丢失 betIndex 关联
  const betId = String(prev?.betId || option.betId || "").trim();
  saveTokenQuote({
    tokenId,
    clobPrice: bestAsk,
    betId,
    side,
    // 本侧已有有效 book ask：必须解锁，否则 getOdds 仍为 0（与 collect WS 路径一致）
    locked: false,
  }, "http", "book-correct");
  notePolymarketLiveBookQuote(tokenId);
}

const lastLiveQuoteTs = new Map<string, number>();
/** 纠偏 fo 后保护窗：无 timestamp 的迟到 WS 不得在此期间把 fo 打回去 */
const LIVE_BOOK_WS_GUARD_MS = 2_000;

export function resetPolymarketLiveQuoteTsForTests(): void {
  lastLiveQuoteTs.clear();
}

/** 「盘口价高于检测价」刚写过 fo：后续更旧的 WS 帧丢掉 */
export function notePolymarketLiveBookQuote(assetId: string, atMs = Date.now()): void {
  const id = String(assetId || "").trim();
  if (!id)
    return;
  const prev = lastLiveQuoteTs.get(id) ?? 0;
  if (atMs > prev)
    lastLiveQuoteTs.set(id, atMs);
}

/**
 * 是否采用本条 WS 卖一。
 * - 有交易所 timestamp：严格新于上次（纠偏 fo 时会钉墙钟）
 * - 无 timestamp：纠偏 fo 后 2s 内拒绝，避免 hub 迟到帧回绕
 */
export function shouldApplyPolymarketWsQuote(assetId: string, exchangeTs?: number): boolean {
  const id = String(assetId || "").trim();
  if (!id)
    return false;
  const prev = lastLiveQuoteTs.get(id) ?? 0;
  const incoming = Number(exchangeTs);
  if (!Number.isFinite(incoming) || incoming <= 0) {
    if (prev > 0 && Date.now() - prev < LIVE_BOOK_WS_GUARD_MS)
      return false;
    return true;
  }
  if (incoming < prev)
    return false;
  lastLiveQuoteTs.set(id, incoming);
  return true;
}
