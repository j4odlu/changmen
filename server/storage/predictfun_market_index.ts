import type { PredictFunMarketIndex } from "@changmen/api-contract";

/**
 * VPS predictfun-collector 写入；浏览器经 Client_GetCollectPlatform.MarketIndex 读取。
 */
import { readJsonFile, writeJsonFile } from "@changmen/storage/json_file_store";

const INDEX_NAME = "predictfun_market_index";

/** @returns {import("@changmen/api-contract").PredictFunMarketIndex | null} */
export function readPredictFunMarketIndex() {
  const raw = readJsonFile<PredictFunMarketIndex | null>(INDEX_NAME, null);
  if (!raw || typeof raw !== "object")
    return null;
  return raw;
}

/** @param {import("@changmen/api-contract").PredictFunMarketIndex} data */
export function writePredictFunMarketIndex(data: PredictFunMarketIndex): void {
  writeJsonFile(INDEX_NAME, data);
}
