// [changmen 扩展] Server configuration belongs here; shared catalog functions stay pure.
import {
  parseActiveGameCodes as selectGameCodes,
  getActiveGames as selectGames,
  getActivePlatformGameIds as selectPlatformGameIds,
  isAllowedPlatformGameId as allowsPlatformGameId,
  getCatalogSummary as summarizeCatalog,
} from "@changmen/shared/catalog/game_catalog";

// Read on each call, preserving startup/configuration changes after module import.
export function parseActiveGameCodes() {
  return selectGameCodes(process.env.AGGREGATE_GAME_CODES);
}

export function getActiveGames() {
  return selectGames(process.env.AGGREGATE_GAME_CODES);
}

export function getActivePlatformGameIds(platform) {
  return selectPlatformGameIds(platform, process.env.AGGREGATE_GAME_CODES);
}

export function isAllowedPlatformGameId(platform, gameId) {
  return allowsPlatformGameId(platform, gameId, process.env.AGGREGATE_GAME_CODES);
}

export function getCatalogSummary() {
  return summarizeCatalog(process.env.AGGREGATE_GAME_CODES);
}
