import type { BetOption } from "@changmen/client-core/models/betOption";
import { truncateOddsTo3 } from "@changmen/shared/odds_format";

/** checkBet / betting 在 option.data 上携带的 PM 检测价（web attachDetectionQuote 写入 clobPrice） */
export interface PolymarketOptionQuoteData {
  detectionOdds?: number;
  detectionMaxPrice?: number;
  detectionClobPrice?: number;
}

export function hasLockedPolymarketDetectionQuote(data: PolymarketOptionQuoteData): boolean {
  const odds = Number(data.detectionOdds);
  if (!Number.isFinite(odds) || odds <= 1)
    return false;
  const price = Number(data.detectionMaxPrice ?? data.detectionClobPrice);
  return isValidClobPrice(price) && polymarketClobMatchesOdds(price, odds);
}

export function isValidClobPrice(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value < 1;
}

/** 十进制赔率 → 检测价上限（无一致 fo clobPrice 时的回退） */
export function detectionMaxPriceFromOdds(detectionOdds: number): number {
  return Math.round((1 / detectionOdds) * 10000) / 10000;
}

/** fo clob 与建腿/检测赔率是否同一档（避免建腿 0.60、预检却用后来 fo 0.58 收紧限价） */
export function polymarketClobMatchesOdds(clobPrice: number, odds: number): boolean {
  if (!isValidClobPrice(clobPrice) || !(odds > 1))
    return false;
  return truncateOddsTo3(1 / clobPrice) === truncateOddsTo3(odds);
}

function readOptionQuoteData(option: BetOption): PolymarketOptionQuoteData {
  if (!option.data || typeof option.data !== "object")
    return {};
  return option.data as PolymarketOptionQuoteData;
}

/**
 * 预检 FOK 限价上限：fo clob 与检测赔率一致时才用，否则 1/检测赔率。
 * 与 PredictFun 对齐；首次预检后 detectionClobPrice 写入 PolymarketBuyCheckData 并锁定。
 */
export function resolvePolymarketDetectionMaxPrice(
  option: BetOption,
  detectionOdds: number,
): number {
  const data = readOptionQuoteData(option);
  const locked = Number(data.detectionMaxPrice ?? data.detectionClobPrice);
  if (isValidClobPrice(locked) && polymarketClobMatchesOdds(locked, detectionOdds))
    return locked;
  return detectionMaxPriceFromOdds(detectionOdds);
}
