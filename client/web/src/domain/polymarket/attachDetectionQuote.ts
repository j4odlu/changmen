import type { BetOption } from "@changmen/client-core/models/betOption";
import { capturePmTickBufferQuote, pmAttemptUsesTickBuffer } from "./tickBufferQuote";
import { PLATFORMS } from "@changmen/venue-adapter/shared";
import { useOddsStore } from "@/stores/oddsStore";
import {
  hasLockedPolymarketDetectionQuote,
  isPmArbPriceBufferActive,
  isValidClobPrice,
  pmExecCapFromRawAsk,
  getPmArbPriceBufferPrefs,
  isPmTickBufferActive,
  validatePmTickBufferQuote,
  polymarketClobMatchesOdds,
  type PolymarketOptionQuoteData,
} from "@changmen/venue-adapter/polymarket";

/**
 * PM 预检前：从 fo 读取 CLOB 写入 option.data（唯一读 fo 入口）。
 * 关：仅当 fo 卖一与建腿赔率同档才锁（现网）。
 * 开：getOdds 已是 effective，与 fo 卖一对不上 → 锁 execCap，供 bet.ts 原样使用。
 */
export function attachPolymarketDetectionQuote(option: BetOption, scope: "esport" | "sport" = "esport"): void {
  if (option.type !== PLATFORMS.Polymarket)
    return;
  // [changmen 扩展] 体育板/POD 使用独立报价，不套用电竞 fo 的 tick 缓冲；百分比仍走原路径。
  if (scope === "sport" && isPmTickBufferActive() && !pmAttemptUsesTickBuffer(option)) return;
  try {
    capturePmTickBufferQuote(option);
    if (pmAttemptUsesTickBuffer(option)) {
      validatePmTickBufferQuote(option.data?.pmTickQuote, option.itemId, Number(option.data?.detectionOdds ?? option.odds));
      return;
    }
  } catch (err) {
    // 通用编排用 data 是否为空判断预检成功，拒绝的 tick 报价不能残留 data。
    if (pmAttemptUsesTickBuffer(option)) option.data = null;
    throw err;
  }
  const prior = (option.data && typeof option.data === "object"
    ? option.data
    : {}) as PolymarketOptionQuoteData;
  if (hasLockedPolymarketDetectionQuote(prior))
    return;
  const row = useOddsStore().getEntry(PLATFORMS.Polymarket, option.itemId);
  const clobPrice = Number(row?.clobPrice);
  if (!isValidClobPrice(clobPrice))
    return;
  const percentPrefs = { ...getPmArbPriceBufferPrefs(), mode: "percent" as const };
  if (isPmArbPriceBufferActive(percentPrefs)) {
    const cap = pmExecCapFromRawAsk(clobPrice, percentPrefs);
    option.data = { ...prior, detectionClobPrice: cap, detectionMaxPrice: cap };
    return;
  }
  if (!polymarketClobMatchesOdds(clobPrice, option.odds))
    return;
  option.data = { ...prior, detectionClobPrice: clobPrice };
}
