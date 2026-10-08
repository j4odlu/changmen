import type { BetOption } from "@changmen/client-core/models/betOption";
import { capturePmPriceQuote, pmAttemptUsesTickBuffer, pmAttemptPricePolicy } from "./tickBufferQuote";
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
  validatePmPriceQuote,
  polymarketClobMatchesOdds,
  type PolymarketOptionQuoteData,
} from "@changmen/venue-adapter/polymarket";

/**
 * PM 预检前验证建腿时冻结的统一报价；未经过建腿入口的尝试在此首次冻结。
 * 体育及未启用调整的路径保留同档原始卖一兼容逻辑。
 */
export function attachPolymarketDetectionQuote(option: BetOption, scope: "esport" | "sport" = "esport"): void {
  if (option.type !== PLATFORMS.Polymarket)
    return;
  // [changmen 扩展] 体育板/POD 使用独立报价，不套用电竞 fo 的 tick 缓冲；百分比仍走原路径。
  if (scope === "sport" && isPmTickBufferActive() && !pmAttemptPricePolicy(option)) return;
  try {
    if (scope === "esport") capturePmPriceQuote(option);
    if (option.data?.pmPriceQuote) {
      validatePmPriceQuote(option.data.pmPriceQuote, option.itemId, Number(option.data.detectionOdds ?? option.odds));
      if (pmAttemptUsesTickBuffer(option))
        validatePmTickBufferQuote(option.data.pmTickQuote, option.itemId, Number(option.data.detectionOdds ?? option.odds));
      return;
    }
    if (pmAttemptUsesTickBuffer(option)) {
      validatePmTickBufferQuote(option.data?.pmTickQuote, option.itemId, Number(option.data?.detectionOdds ?? option.odds));
      return;
    }
  } catch (err) {
    // 通用编排用 data 是否为空判断预检成功，拒绝的调整报价不能残留 data。
    if (pmAttemptPricePolicy(option)?.enabled) option.data = null;
    throw err;
  }
  const prior = (option.data && typeof option.data === "object"
    ? option.data
    : {}) as PolymarketOptionQuoteData;
  if (hasLockedPolymarketDetectionQuote(prior))
    return;
  const row = scope === "esport" ? useOddsStore().getPmQuoteEntry(option.itemId)
    : useOddsStore().getEntry(PLATFORMS.Polymarket, option.itemId);
  const clobPrice = Number(row?.clobPrice);
  if (!isValidClobPrice(clobPrice))
    return;
  const percentPrefs = { ...(pmAttemptPricePolicy(option) ?? getPmArbPriceBufferPrefs()), mode: "percent" as const };
  if (isPmArbPriceBufferActive(percentPrefs)) {
    const cap = pmExecCapFromRawAsk(clobPrice, percentPrefs);
    option.data = { ...prior, detectionClobPrice: cap, detectionMaxPrice: cap };
    return;
  }
  if (!polymarketClobMatchesOdds(clobPrice, option.odds))
    return;
  option.data = { ...prior, detectionClobPrice: clobPrice };
}
