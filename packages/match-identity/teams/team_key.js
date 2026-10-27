import { isPlaceholderTeamName } from "./match_utils.js";
import teamAliasesJson from "./team_aliases.json" with { type: "json" };

/**
 * 队伍名称归一化 + 跨平台 canonical key 计算。
 * team-resolver 插件通过 setTeamPlugin() 注入，不注入时行为与原来完全一致。
 */

// ── team-resolver 插件桥 ──────────────────────────────────────────────────────

let _teamPlugin = null;

function setTeamPlugin(plugin) { _teamPlugin = plugin; }

function _lookupByName(gameCode, normalizedName) {
  if (!_teamPlugin)
    return null;
  if (typeof _teamPlugin === "function")
    return _teamPlugin(gameCode, normalizedName);
  return _teamPlugin.lookupByName?.(gameCode, normalizedName) || null;
}

function _lookupById(platform, platformId) {
  if (!_teamPlugin || typeof _teamPlugin === "function")
    return null;
  return _teamPlugin.lookupById?.(platform, platformId) || null;
}

function _saveMapping(canonId, platform, platformId, platformName) {
  if (!_teamPlugin || typeof _teamPlugin === "function")
    return;
  _teamPlugin.saveMapping?.(canonId, platform, platformId, platformName);
}

function lookupGbTeamIdByPlatform(platform, platformId) {
  return _lookupById(platform, platformId);
}

function lookupCanonicalTeamName(gbTeamId) {
  if (!_teamPlugin || typeof _teamPlugin === "function")
    return null;
  return _teamPlugin.lookupCanonicalName?.(String(gbTeamId)) || null;
}

// ── 队名归一化 ────────────────────────────────────────────────────────────────

const _aliases = Object.fromEntries(
  Object.entries(teamAliasesJson).filter(([k]) => !k.startsWith("_")),
);
function getAliases() {
  return _aliases;
}

/** OB 等场馆偶发把 `'` 存成 `&apos;`；先解码再归一，避免 `lifeaposs a game` */
function decodeHtmlEntities(s) {
  return String(s || "")
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, "\"")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

/**
 * 小写 → 去标点 → 去末尾通用后缀（esports/gaming）→ 别名替换。
 * 保留 CJK 字符，支持 team_aliases.json 扩展。
 */
function normalizeTeam(name) {
  const base = decodeHtmlEntities(name)
    .toLowerCase()
    .replace(/[·\-—_•\s]+/g, " ")
    .replace(/[^\w\s一-鿿]/g, "")
    .trim()
    .replace(/\s+(?:esports?|gaming)$/, "")
    .trim();
  return getAliases()[base] || base;
}

// ── canonical key ─────────────────────────────────────────────────────────────

/**
 * 计算赛事的规范化 key（兼容旧逻辑：ID / canonical 队名 / 归一化队名混合）。
 * 新合并流程请用 canonicalMatchKeyByIdOnly + canonicalMatchKeyByName 两阶段。
 */
function canonicalMatchKey(gameId, home, away, gameCode, ctx) {
  const nh = normalizeTeam(home);
  const na = normalizeTeam(away);
  if (!nh || !na)
    return null;
  if (isPlaceholderTeamName(nh) || isPlaceholderTeamName(na))
    return null;

  let hk = nh;
  let ak = na;

  if (_teamPlugin && gameCode) {
    const provider = ctx?.provider;
    const homeCanonId
      = (provider && _lookupById(provider, ctx?.homeId))
        || _lookupByName(gameCode, nh);
    const awayCanonId
      = (provider && _lookupById(provider, ctx?.awayId))
        || _lookupByName(gameCode, na);

    if (homeCanonId && awayCanonId) {
      hk = homeCanonId;
      ak = awayCanonId;
    }

    if (provider) {
      if (homeCanonId && ctx?.homeId)
        _saveMapping(homeCanonId, provider, ctx.homeId, home, gameCode);
      if (awayCanonId && ctx?.awayId)
        _saveMapping(awayCanonId, provider, ctx.awayId, away, gameCode);
    }
  }

  return _packMatchKey(gameId, hk, ak, "legacy");
}

/** 第一阶段：仅 platform_id → gb_team_id，主客两队都必须映射成功 */
function canonicalMatchKeyByIdOnly(gameId, home, away, gameCode, ctx) {
  const nh = normalizeTeam(home);
  const na = normalizeTeam(away);
  if (!nh || !na)
    return null;
  if (isPlaceholderTeamName(nh) || isPlaceholderTeamName(na))
    return null;
  if (!_teamPlugin || !gameCode || !ctx?.provider)
    return null;

  const homeId = String(ctx.homeId || "").trim();
  const awayId = String(ctx.awayId || "").trim();
  if (!homeId || !awayId)
    return null;

  const homeCanonId = _lookupById(ctx.provider, homeId);
  const awayCanonId = _lookupById(ctx.provider, awayId);
  if (!homeCanonId || !awayCanonId)
    return null;

  return _packMatchKey(gameId, homeCanonId, awayCanonId, "id");
}

/** 第二阶段：仅队名归一化（不做 ID / canonical 队名查找） */
function canonicalMatchKeyByName(gameId, home, away) {
  const nh = normalizeTeam(home);
  const na = normalizeTeam(away);
  if (!nh || !na)
    return null;
  if (isPlaceholderTeamName(nh) || isPlaceholderTeamName(na))
    return null;
  return _packMatchKey(gameId, nh, na, "name");
}

function _packMatchKey(gameId, hk, ak, kind) {
  const reversed = hk > ak;
  const [first, second] = reversed ? [ak, hk] : [hk, ak];
  const prefix = kind === "id" ? "match:id:" : kind === "name" ? "match:name:" : "match:";
  const mergeKey = `${prefix}${String(gameId || "")}:${first}:${second}`;
  return {
    mergeKey,
    key: mergeKey,
    reversed,
    basis: kind === "id" ? "id" : kind === "name" ? "name" : "legacy",
  };
}

/** 判定跨平台合并键是否由平台队伍 ID（team_venue_maps）解析成功 */
function classifyMergeBasis(home, away, gameCode, ctx) {
  const nh = normalizeTeam(home);
  const na = normalizeTeam(away);
  if (!nh || !na)
    return "unknown";

  if (_teamPlugin && gameCode && ctx?.provider) {
    const homeId = String(ctx.homeId || "").trim();
    const awayId = String(ctx.awayId || "").trim();
    if (homeId && awayId) {
      const hi = _lookupById(ctx.provider, homeId);
      const ai = _lookupById(ctx.provider, awayId);
      if (hi && ai)
        return "id";
    }
  }
  return "name";
}

/** canonical / map 上的「未知(N)」占位，不能当真实 game 做串线校验 */
function isUnresolvedGameLabel(game) {
  const g = String(game || "").trim().toLowerCase();
  if (!g)
    return true;
  return g === "unknown" || g.startsWith("未知");
}

function lookupGbTeamIdByName(teamName, gameCode) {
  const normalized = normalizeTeam(teamName);
  if (!normalized)
    return null;
  if (!_teamPlugin)
    return null;
  const game = String(gameCode || "").trim().toLowerCase() || null;
  if (game && typeof _teamPlugin.lookupGbTeamIdByNormalizedNameForGame === "function") {
    const scoped = _teamPlugin.lookupGbTeamIdByNormalizedNameForGame(game, normalized);
    if (scoped)
      return scoped;
  }
  if (typeof _teamPlugin.lookupGbTeamIdByNormalizedName !== "function")
    return null;
  const unscoped = _teamPlugin.lookupGbTeamIdByNormalizedName(normalized) || null;
  if (!unscoped)
    return null;
  // 有本场 game 时：禁止把其它已知游戏的同名队当回落（#670 EDG val→kog）
  if (game) {
    const gbGame = lookupGameForGbTeamId(unscoped);
    if (gbGame && !isUnresolvedGameLabel(gbGame) && String(gbGame).toLowerCase() !== game)
      return null;
  }
  return unscoped;
}

function lookupGameForGbTeamId(gbTeamId) {
  if (!_teamPlugin || typeof _teamPlugin === "function")
    return null;
  return _teamPlugin.lookupGameForGbTeamId?.(String(gbTeamId)) || null;
}

/** 锚点 gb 须与本场 gameCode 一致，防止 cs2/valorant 等同名队串线 */
function anchorGbValidForGame(gbTeamId, gameCode) {
  const gb = gbTeamId == null || gbTeamId === "" ? null : String(gbTeamId).trim();
  const game = String(gameCode || "").trim().toLowerCase();
  if (!gb || !game)
    return true;
  const gbGame = lookupGameForGbTeamId(gb);
  if (!gbGame || isUnresolvedGameLabel(gbGame))
    return true;
  return String(gbGame).toLowerCase() === game;
}

export {
  anchorGbValidForGame,
  canonicalMatchKey,
  canonicalMatchKeyByIdOnly,
  canonicalMatchKeyByName,
  classifyMergeBasis,
  isUnresolvedGameLabel,
  lookupCanonicalTeamName,
  lookupGameForGbTeamId,
  lookupGbTeamIdByName,
  lookupGbTeamIdByPlatform,
  normalizeTeam,
  setTeamPlugin,
};
