import type { PolymarketMarketIndex } from "@changmen/api-contract";

/**
 * VPS polymarket-esports-collector 写入；浏览器经 Client_GetCollectPlatform.MarketIndex 读取。
 */
import { readJsonFile, writeJsonFile } from "@changmen/storage/json_file_store.js";

const INDEX_NAME = "polymarket_market_index";

/** @returns {import("@changmen/api-contract").PolymarketMarketIndex | null} */
export function readPolymarketMarketIndex() {
  const raw = readJsonFile<PolymarketMarketIndex | null>(INDEX_NAME, null);
  if (!raw || typeof raw !== "object")
    return null;
  return raw;
}

/** @param {import("@changmen/api-contract").PolymarketMarketIndex} data */
export function writePolymarketMarketIndex(data: PolymarketMarketIndex): void {
  writeJsonFile(INDEX_NAME, data);
}
