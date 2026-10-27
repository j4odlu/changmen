import type { SxBetMarketIndex } from "@changmen/api-contract";

/**
 * VPS sxbet-collector 写入；浏览器经 Client_GetCollectPlatform.MarketIndex 读取。
 */
import { readJsonFile, writeJsonFile } from "@changmen/storage/json_file_store.js";

const INDEX_NAME = "sxbet_market_index";

/** @returns {import("@changmen/api-contract").SxBetMarketIndex | null} */
export function readSxBetMarketIndex() {
  const raw = readJsonFile<SxBetMarketIndex | null>(INDEX_NAME, null);
  if (!raw || typeof raw !== "object")
    return null;
  return raw;
}

/** @param {import("@changmen/api-contract").SxBetMarketIndex} data */
export function writeSxBetMarketIndex(data: SxBetMarketIndex): void {
  writeJsonFile(INDEX_NAME, data);
}
