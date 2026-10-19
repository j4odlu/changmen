/**
 * PM 写 fo 的唯一入口（采集 WS + 预检 book 纠偏共用）。
 */
import type { BetOption } from "@changmen/client-core/models/betOption";
import { getVenueOddsEntry, saveVenueOdds } from "@changmen/client-core/bridge/oddsAccess";
import { PLATFORMS } from "@changmen/client-core/shared/platforms";
import { decimalOddsFromProbability } from "../markets/parse";
import { isValidClobPrice } from "../submission/preflight/pmDetection";
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

import { PolymarketPriceAboveDetectionError } from "../pmPriceError";
export { PolymarketPriceAboveDetectionError, isPolymarketPriceAboveDetectionError } from "../pmPriceError";

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

import { notePolymarketLiveBookQuote } from "../liveQuoteState";
export { resetPolymarketLiveQuoteTsForTests, notePolymarketLiveBookQuote, shouldApplyPolymarketWsQuote } from "../liveQuoteState";
