import { resolveGameCode } from "@changmen/shared/catalog/game_catalog";

export const MIN_PLATFORMS = 2;

/** [changmen 扩展] 篮球测试允许一馆成场，其它游戏仍至少两馆。 */
export function minimumPlatformsForGame(game) {
  return resolveGameCode(game) === "basketball" ? 1 : MIN_PLATFORMS;
}

export function hasRequiredPlatforms(row) {
  return Object.keys(row?.Matchs || {}).length >= minimumPlatformsForGame(row?.Game);
}
