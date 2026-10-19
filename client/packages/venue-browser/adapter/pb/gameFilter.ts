import { getGameCodeForPlatformId } from "@changmen/shared/catalog/game_catalog.browser";
import { slugify } from "./parse";

/**
 * [A8 可证实] `YY`：`e.games.includes(a.SourceGameID)`（SourceGameID = slugify(league.gameCode)）。
 *
 * changmen catalog / Client_GetGames 常下发 `cs2`，而 euro/odds 的 gameCode 可能是 `cs-go`：
 * 在精确匹配之外，若两边映射到同一 catalog code 也放行（否则整游戏被丢光，A8 有、changmen 无）。
 */
export function isPbAllowedSourceGameId(
  sourceGameId: string,
  platformGames: readonly string[],
): boolean {
  const slug = slugify(sourceGameId);
  if (!slug || !platformGames.length) return false;
  const allowed = platformGames.map(slugify).filter(Boolean);
  if (allowed.includes(slug)) return true;

  const sourceCode = getGameCodeForPlatformId("PB", slug);
  if (!sourceCode) return false;
  return allowed.some((g) => getGameCodeForPlatformId("PB", g) === sourceCode);
}
