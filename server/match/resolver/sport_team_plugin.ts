/**
 * Sport N3 队名解析（MLB 读本包 JSON；足球走 @changmen/shared 单一来源）。
 * 禁止 import 电竞 team_db / fetchAllCanonicalTeams。
 */
import type { SportTeamPlugin } from "./types.ts";
import mlbAliasesRaw from "./sport_mlb_aliases.json" with { type: "json" };
import {
  normFootballTeamName,
  resolveFootballTeamKey,
} from "@changmen/shared/catalog/football_team_key";

const FOOTBALL_GAMES = new Set([
  "soccer",
  "football",
  "unknown_fb",
  "epl",
  "lal",
  "bun",
  "fl1",
  "sea",
  "ucl",
  "uel",
  "uecl",
  "mls",
  "ere",
  "por",
  "uef",
  "fif",
  "mex",
  "bra",
  "arg",
  "copa",
  "jap",
  "afc",
  "caf",
  "chi",
  "chi2",
]);

/** @type {Map<string, string>|null} */
let mlbMap: Map<string, string> | null = null;

function loadMlbMap() {
  if (mlbMap)
    return mlbMap;
  mlbMap = new Map();
  for (const [k, v] of Object.entries(mlbAliasesRaw)) {
    if (k.startsWith("_"))
      continue;
    const key = String(k).trim().toLowerCase();
    const val = String(v).trim().toLowerCase();
    if (key && val)
      mlbMap.set(key, val);
  }
  return mlbMap;
}

function isFootballGame(gameCode: unknown) {
  return FOOTBALL_GAMES.has(String(gameCode || "").toLowerCase());
}

/** MLB 归一（保持原状）：去撇号后再折叠空白，避免 A's → "a s"。 */
export function baseNormSportTeamName(name: unknown) {
  return String(name || "")
    .toLowerCase()
    .replace(/[''`´]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9一-鿿]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * @param {string} name
 * @param {string} [gameCode] mlb | soccer | …
 * @returns {string} 用于配对的 canonical key
 */
export function resolveSportTeamKey(name: string, gameCode = "mlb") {
  const game = String(gameCode || "mlb").toLowerCase();
  if (game === "mlb") {
    const n = baseNormSportTeamName(name);
    if (!n)
      return "";
    return loadMlbMap().get(n) || n;
  }
  if (isFootballGame(game))
    return resolveFootballTeamKey(name);
  const n = baseNormSportTeamName(name);
  return n;
}

export { normFootballTeamName };

/**
 * @param {string} home
 * @param {string} away
 * @param {number} startTimeMs
 * @param {string} [gameCode]
 * @returns {string|null}
 */
export function sportPairKeyResolved(home: string, away: string, startTimeMs: number, gameCode = "mlb") {
  const game = String(gameCode || "mlb").toLowerCase().trim() || "mlb";
  const h = resolveSportTeamKey(home, game);
  const a = resolveSportTeamKey(away, game);
  if (!h || !a)
    return null;
  const t = Number(startTimeMs) || 0;
  if (t <= 0)
    return null;
  const bucket = Math.floor(t / (60 * 60 * 1000));
  const [x, y] = h < a ? [h, a] : [a, h];
  // 与电竞「同 Game 才匹配」对齐：mlb/kbo/npb（或 soccer/tennis）写入键前缀
  return `${game}|${x}|${y}|${bucket}`;
}

/**
 * 同步插件形状（供 merge / 测试）；不读 RDS。
 * @param {{ games?: string[] }} [opts]
 */
export function createSportTeamPlugin(opts: { games?: string[] } = {}): SportTeamPlugin {
  const games = (opts.games || ["mlb"]).map(g => String(g).toLowerCase());
  const defaultGame = games[0] || "mlb";
  return {
    resolveKey(name, gameCode) {
      const g = gameCode || defaultGame;
      if (games.length && !games.includes(String(g).toLowerCase()))
        return baseNormSportTeamName(name);
      return resolveSportTeamKey(name, g);
    },
    pairKey(home, away, startTimeMs, gameCode) {
      return sportPairKeyResolved(home, away, startTimeMs, gameCode || defaultGame);
    },
  };
}
