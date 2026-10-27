import esportCatalog from "./game_catalog.json" with { type: "json" };
import sportsCatalog from "./game_catalog_sports.json" with { type: "json" };
import { getConfiguredGameAlias } from "./game_catalog_rules.js";

export {
  getConfiguredPlatformDiscovery,
  getConfiguredPlatformGameIds,
  matchConfiguredPlatformGameText,
} from "./game_catalog_rules.js";

export const DEFAULT_GAME_SPORT = "esport";

interface GameEntry {
  code: string;
  sport?: string;
  name: string;
  nameEn: string;
  a8GameId?: number;
  clientGameId?: number;
  a8Name?: string;
  platforms?: Record<string, string>;
}

/** 电竞 + 体育合并视图；对外 listGames / resolve 仍走此对象。 */
const catalog = {
  version: Math.max(Number(esportCatalog.version) || 0, Number(sportsCatalog.version) || 0),
  updatedAt: [esportCatalog.updatedAt, sportsCatalog.updatedAt].filter(Boolean).sort().at(-1) || "",
  description: "merged game_catalog.json (esport) + game_catalog_sports.json",
  games: [
    ...((esportCatalog.games || []) as GameEntry[]),
    ...((sportsCatalog.games || []) as GameEntry[]),
  ],
};

function listGames(): GameEntry[] {
  return (catalog.games as GameEntry[]).slice();
}

function getGameByCode(code: string): GameEntry | null {
  const key = String(code || "").trim().toLowerCase();
  if (!key)
    return null;
  return (catalog.games as GameEntry[]).find(g => g.code === key) || null;
}

/** game_catalog.code → sport；缺省 esport */
function getGameSport(code: string): string | null {
  const game = getGameByCode(code);
  if (!game)
    return null;
  return game.sport ?? DEFAULT_GAME_SPORT;
}

/**
 * UI 展示名：catalog code → name；电竞 Client_GetMatchs 已下发中文名时原样返回。
 * 内部合并/配对仍用 code，不在此改写。
 */
function getGameDisplayName(codeOrName: string): string {
  const raw = String(codeOrName || "").trim();
  if (!raw)
    return "";
  const game = getGameByCode(raw);
  if (game)
    return game.name || raw;
  return raw;
}

/**
 * UI / 图标：把 Client_GetMatchs 的 Game（中文名 / a8Name / code）解析成 catalog code。
 * 匹配 code、name、nameEn、a8Name（大小写不敏感）。
 */
function resolveGameCode(codeOrName: string): string | null {
  const raw = String(codeOrName || "").trim();
  if (!raw)
    return null;
  const byCode = getGameByCode(raw);
  if (byCode)
    return byCode.code;
  const key = raw.toLowerCase();
  for (const game of catalog.games as GameEntry[]) {
    if (
      game.name?.toLowerCase() === key
      || game.nameEn?.toLowerCase() === key
      || game.a8Name?.toLowerCase() === key
    ) {
      return game.code;
    }
  }
  return null;
}

/** Client_GetGames / 采集凭证：仅电竞条目（棒球/足球联赛不进 venue_games） */
function isEsportCatalogGame(game: GameEntry): boolean {
  return (game.sport ?? DEFAULT_GAME_SPORT) === "esport";
}

function normalizePlatformKey(platform: string): string {
  const raw = String(platform || "").trim();
  if (!raw)
    return raw;
  const lower = raw.toLowerCase();
  const hit = (catalog.games as GameEntry[])
    .flatMap(g => Object.keys(g.platforms || {}))
    .find(key => key.toLowerCase() === lower);
  return hit || raw;
}

/** Pure selection: the host supplies its configuration; omitted input selects all esport games. */
function parseActiveGameCodes(raw?: string): string[] {
  const all = (catalog.games as GameEntry[]).filter(isEsportCatalogGame);
  if (!raw || raw === "*") {
    return all.map(g => g.code);
  }
  const wanted = new Set(
    raw
      .split(/[,;\s]+/)
      .map(s => s.trim().toLowerCase())
      .filter(Boolean),
  );
  return all.filter(g => wanted.has(g.code)).map(g => g.code);
}

function getActiveGames(raw?: string): GameEntry[] {
  const codes = new Set(parseActiveGameCodes(raw));
  return (catalog.games as GameEntry[]).filter(g => codes.has(g.code));
}

function getPlatformGameId(platform: string, code: string): string | null {
  platform = normalizePlatformKey(platform);
  const game = getGameByCode(code);
  const id = game?.platforms?.[platform];
  return id != null ? String(id) : null;
}

function getGameCodeForPlatformId(platform: string, gameId: string | number | null | undefined): string | null {
  platform = normalizePlatformKey(platform);
  const id = String(gameId);
  const alias = getConfiguredGameAlias(platform, id);
  if (alias)
    return alias;
  for (const game of catalog.games as GameEntry[]) {
    const nativeId = game.platforms?.[platform];
    if (nativeId != null && String(nativeId) === id) {
      return game.code;
    }
  }
  return null;
}

function isAllowedPlatformGameId(platform: string, gameId: string | number, raw?: string): boolean {
  const code = getGameCodeForPlatformId(platform, gameId);
  if (!code)
    return false;
  return parseActiveGameCodes(raw).includes(code);
}

function getActivePlatformGameIds(platform: string, raw?: string): string[] {
  platform = normalizePlatformKey(platform);
  return getActiveGames(raw)
    .map(g => g.platforms?.[platform])
    .filter(Boolean)
    .map(String);
}

interface PlatformGameDescription {
  gameCode: string;
  gameName: string;
  gameNameEn: string;
  a8GameId: number | null;
  inCatalog: boolean;
}

function describePlatformGame(platform: string, gameId: string | number | null | undefined): PlatformGameDescription {
  const code = getGameCodeForPlatformId(platform, gameId);
  if (code) {
    const game = getGameByCode(code);
    return {
      gameCode: code,
      gameName: game?.a8Name || game?.name || code,
      gameNameEn: game?.nameEn || code,
      a8GameId: game?.a8GameId ?? null,
      inCatalog: true,
    };
  }
  return {
    gameCode: "unknown",
    gameName: `未知(${gameId})`,
    gameNameEn: "Unknown",
    a8GameId: null,
    inCatalog: false,
  };
}

interface ClientGameResult {
  Game: string;
  GameID: number;
}

/** Client_GetMatchs 的 Game / GameID（A8 服务端整理后下发，前端直接展示 Game） */
function resolveClientGame(platform: string, sourceGameId: string | number | null | undefined): ClientGameResult {
  const info = describePlatformGame(platform, sourceGameId);
  const game = getGameByCode(info.gameCode);
  return {
    Game: info.gameName,
    GameID: game?.clientGameId ?? info.a8GameId ?? 0,
  };
}

interface CatalogSummary {
  version: number;
  updatedAt: string;
  activeCodes: string[];
  games: {
    code: string;
    name: string;
    nameEn: string;
    platformIds: Record<string, string> | undefined;
  }[];
}

function getCatalogSummary(raw?: string): CatalogSummary {
  return {
    version: catalog.version,
    updatedAt: catalog.updatedAt,
    activeCodes: parseActiveGameCodes(raw),
    games: getActiveGames(raw).map(g => ({
      code: g.code,
      name: g.name,
      nameEn: g.nameEn,
      platformIds: g.platforms,
    })),
  };
}

export {
  catalog,
  describePlatformGame,
  getActiveGames,
  getActivePlatformGameIds,
  getCatalogSummary,
  getGameByCode,
  getGameCodeForPlatformId,
  getGameDisplayName,
  getGameSport,
  getPlatformGameId,
  isAllowedPlatformGameId,
  listGames,
  parseActiveGameCodes,
  resolveClientGame,
  resolveGameCode,
};
