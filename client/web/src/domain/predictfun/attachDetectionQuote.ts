import type { BetOption } from "@changmen/client-core/models/betOption";
import { PLATFORMS } from "@changmen/venue-browser/adapter/shared";
import { useOddsStore } from "@/stores/oddsStore";
import {
  isPfArbPriceBufferActive,
  isValidPredictClobPrice,
  lookupPredictFunMarketIdByToken,
  pfExecCapFromRawAsk,
  predictFunClobMatchesOdds,
  type PredictFunOptionQuoteData,
} from "@changmen/venue-browser/adapter/predictfun";

function hasLockedPredictFunDetectionQuote(data: PredictFunOptionQuoteData): boolean {
  // 只认 detectionClobPrice；detectionMaxPrice 可能是执行限价副本，不能当锁定依据
  return isValidPredictClobPrice(Number(data.detectionClobPrice));
}

/**
 * PF 预检前：从 fo 读取 CLOB / marketId 写入 option.data。
 * 关：仅当 fo 卖一与建腿赔率同档才锁原卖一。
 * 开：getOdds 已是 effective → 锁 execCap，供 resolve 同档命中。
 */
export function attachPredictFunDetectionQuote(option: BetOption): void {
  if (option.type !== PLATFORMS.PredictFun)
    return;
  const prior = (option.data && typeof option.data === "object"
    ? option.data
    : {}) as PredictFunOptionQuoteData & { marketId?: string };
  const row = useOddsStore().getEntry(PLATFORMS.PredictFun, option.itemId);
  const marketId = String(
    prior.marketId
    || row?.marketId
    || lookupPredictFunMarketIdByToken(option.itemId)
    || "",
  ).trim();
  const patch: PredictFunOptionQuoteData & { marketId?: string } = { ...prior };
  if (marketId && !prior.marketId)
    patch.marketId = marketId;
  if (!hasLockedPredictFunDetectionQuote(prior)) {
    const clobPrice = Number(row?.clobPrice);
    if (isValidPredictClobPrice(clobPrice)) {
      if (isPfArbPriceBufferActive()) {
        const cap = pfExecCapFromRawAsk(clobPrice);
        patch.detectionClobPrice = cap;
        patch.detectionMaxPrice = cap;
      }
      else if (predictFunClobMatchesOdds(clobPrice, option.odds)) {
        patch.detectionClobPrice = clobPrice;
      }
    }
  }
  if (patch.marketId || patch.detectionClobPrice != null)
    option.data = patch as Record<string, unknown>;
}
