import type { BetOption } from "@changmen/client-core/models/betOption";
import { truncateOddsTo3 } from "@changmen/shared/odds_format";

export interface PredictFunOptionQuoteData {
  detectionOdds?: number;
  detectionMaxPrice?: number;
  detectionClobPrice?: number;
}

export function isValidPredictClobPrice(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value < 1;
}

export function detectionMaxPriceFromOdds(detectionOdds: number): number {
  return Math.round((1 / detectionOdds) * 10000) / 10000;
}

function readOptionQuoteData(option: BetOption): PredictFunOptionQuoteData {
  if (!option.data || typeof option.data !== "object")
    return {};
  return option.data as PredictFunOptionQuoteData;
}

/** fo clob 与当前展示赔率是否同一档（避免 Sources=1.587 却用旧 fo=0.62 限价） */
export function predictFunClobMatchesOdds(clobPrice: number, odds: number): boolean {
  if (!isValidPredictClobPrice(clobPrice) || !(odds > 1))
    return false;
  return truncateOddsTo3(1 / clobPrice) === truncateOddsTo3(odds);
}

/**
 * 检测限价上限（裸价）。
 * 仅认 detectionClobPrice；detectionMaxPrice 可能是执行限价副本，不参与 raw。
 * 可配卖一缓冲开时，attach 会把 detectionClobPrice 写成 execCap（与 effectiveOdds 同档）。
 */
export function resolvePredictFunDetectionMaxPriceRaw(
  option: BetOption,
  detectionOdds: number,
): number {
  const data = readOptionQuoteData(option);
  const locked = Number(data.detectionClobPrice);
  if (isValidPredictClobPrice(locked) && predictFunClobMatchesOdds(locked, detectionOdds))
    return locked;
  return detectionMaxPriceFromOdds(detectionOdds);
}

/** 预检执行限价 = raw（已删除硬编码 30bps；缓冲仅经 pfArbPriceBuffer + attach） */
export function resolvePredictFunDetectionMaxPrice(
  option: BetOption,
  detectionOdds: number,
): number {
  return resolvePredictFunDetectionMaxPriceRaw(option, detectionOdds);
}
