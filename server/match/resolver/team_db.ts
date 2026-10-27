/**
 * 从 RDS 加载队伍映射，构建同步查找插件。
 */

/// <reference path="./database-port.d.ts" />
import type { IdentityId, OptionalIdentityId } from "@changmen/match-identity/types";
import type { TeamProviderRow, TeamResolverPlugin } from "./types.ts";
import { loadChangmenEnv } from "@changmen/storage/load_env";
import teamAliasesRaw from "@changmen/match-identity/teams/team_aliases.json" with { type: "json" };
import { resolveCanonicalTeamName } from "@changmen/match-identity/teams/canonical_ob_name.js";

loadChangmenEnv();

let _aliases: Record<string, string> | null = null;
function _getAliases() {
  if (!_aliases) {
    _aliases = Object.fromEntries(
      Object.entries(teamAliasesRaw).filter(([k]) => !k.startsWith("_")),
    );
  }
  return _aliases;
}

function _decodeHtmlEntities(s: unknown) {
  return String(s || "")
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, "\"")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function _norm(name: unknown) {
  const base = _decodeHtmlEntities(name)
    .toLowerCase()
    .replace(/[·\-—_·•\s]+/g, " ")
    .replace(/[^\w\s一-鿿]/g, "")
    .trim()
    .replace(/\s+(?:esports?|gaming)$/i, "")
    .trim();
  return _getAliases()[base] || base;
}

/** catalog 未识别时 scrapers 会写成「未知(N)」，不能当真实 game */
function _isUnresolvedGame(game: unknown) {
  const g = String(game || "").trim().toLowerCase();
  if (!g)
    return true;
  return g === "unknown" || g.startsWith("未知");
}

export async function loadAndCreatePlugin(): Promise<TeamResolverPlugin> {
  const teamDb = await import("@changmen/db");

  const allTeams = await teamDb.fetchAllCanonicalTeams();

  const nameMap = new Map<string, string>();
  const gbTeamNameMap = new Map<string, string>();
  for (const team of allTeams) {
    const id = String(team.id);
    const g = team.game;
    const displayName = String(team.name || "").trim();
    if (team.gb_team_id != null && displayName) {
      gbTeamNameMap.set(String(team.gb_team_id), displayName);
    }
    const nameKey = _norm(team.name);
    if (nameKey) nameMap.set(`${g}:${nameKey}`, id);
    const ENABLE_ACRONYM_NAME_LOOKUP = false;
    if (ENABLE_ACRONYM_NAME_LOOKUP && team.acronym) {
      const acronymKey = _norm(team.acronym);
      if (acronymKey && acronymKey !== nameKey) nameMap.set(`${g}:${acronymKey}`, id);
    }
  }

  // team_provider_ids（多数据源 provider 索引）：team_id → [{provider, provider_id, game}]
  const providerIdMap = new Map<string, TeamProviderRow[]>();
  try {
    const allProviderIds = await teamDb.fetchAllTeamProviderIds();
    for (const row of allProviderIds || []) {
      const tid = String(row.team_id);
      if (!providerIdMap.has(tid))
        providerIdMap.set(tid, []);
      providerIdMap.get(tid)!.push(row);
    }
  }
  catch (err) {
    console.warn("[team-resolver] fetchAllTeamProviderIds 失败:", (err as { message?: unknown }).message);
  }

  const allMaps = await teamDb.fetchAllTeamPlatformMaps();

  const idMap = new Map<string, string>();
  const obNameByGbId = new Map<string, string>();
  const _savedIds = new Set<string>();
  /** gb → 场馆侧已识别 game（优先 OB），用于纠正 canonical「未知(N)」 */
  const gameFromMaps = new Map<string, string>();

  for (const row of allMaps) {
    if (!row.venue_team_id) continue;
    const key = `${row.venue}:${row.venue_team_id}`;
    _savedIds.add(key);
    if (!row.gb_team_id) continue;
    const gbKey = String(row.gb_team_id);
    idMap.set(key, gbKey);
    if (row.venue === "OB" && !obNameByGbId.has(gbKey)) {
      const obName = String(row.venue_name || "").trim();
      if (obName) obNameByGbId.set(gbKey, obName);
    }
    const mapGame = String(row.game || "").trim();
    if (mapGame && !_isUnresolvedGame(mapGame)) {
      const prev = gameFromMaps.get(gbKey);
      if (!prev || row.venue === "OB")
        gameFromMaps.set(gbKey, mapGame);
    }
  }

  const nameOnlyMap = new Map<string, string>();
  const gbTeamIdByGameName = new Map<string, string>();
  const gbTeamGameMap = new Map<string, string | null>();
  for (const team of allTeams) {
    if (team.gb_team_id == null) continue;
    const gbKey = String(team.gb_team_id);
    let g = team.game;
    if (_isUnresolvedGame(g) && gameFromMaps.has(gbKey))
      g = gameFromMaps.get(gbKey)!;
    gbTeamGameMap.set(gbKey, g);
    const displayName = resolveCanonicalTeamName(
      obNameByGbId.get(gbKey),
      team.name,
    );
    if (!displayName) continue;
    const nameKey = _norm(displayName);
    if (nameKey) {
      nameMap.set(`${g}:${nameKey}`, String(team.id));
      gbTeamIdByGameName.set(`${g}:${nameKey}`, gbKey);
      if (!nameOnlyMap.has(nameKey)) nameOnlyMap.set(nameKey, gbKey);
    }
  }

  console.log(
    `[team-resolver] 加载完成 — ${allTeams.length} 支队伍 / ${nameMap.size} 个名称映射 / ${idMap.size} 个平台ID映射`,
  );

  function lookupByName(gameCode: string, normalizedName: string) {
    return nameMap.get(`${gameCode}:${normalizedName}`) || null;
  }

  function lookupById(platform: string, platformId: OptionalIdentityId) {
    if (!platformId) return null;
    return idMap.get(`${platform}:${platformId}`) || null;
  }

  function lookupCanonicalName(gbTeamId: OptionalIdentityId) {
    if (gbTeamId == null || gbTeamId === "") return null;
    const key = String(gbTeamId);
    return resolveCanonicalTeamName(obNameByGbId.get(key), gbTeamNameMap.get(key));
  }

  function saveMapping(gbTeamId: IdentityId, platform: string, platformId: IdentityId, platformName: unknown, gameCode?: string) {
    const manualId = Number(gbTeamId);
    if (!platformId || !Number.isFinite(manualId) || manualId < 100000) return;
    const key = `${platform}:${platformId}`;
    if (_savedIds.has(key)) return;
    _savedIds.add(key);
    idMap.set(key, String(manualId));

    teamDb.saveTeamMappingFireAndForget({
      gb_team_id: manualId,
      platform,
      venue_team_id: String(platformId),
      venue_name: String(platformName || ""),
      game: gameCode || null,
      source: "auto",
      confidence: 1.0,
    });
  }

  function lookupGbTeamIdByNormalizedName(normalizedName: string) {
    return nameOnlyMap.get(normalizedName) || null;
  }

  function lookupGbTeamIdByNormalizedNameForGame(gameCode: string, normalizedName: string) {
    if (!gameCode || !normalizedName)
      return null;
    return gbTeamIdByGameName.get(`${gameCode}:${normalizedName}`) || null;
  }

  function lookupGameForGbTeamId(gbTeamId: OptionalIdentityId) {
    if (gbTeamId == null || gbTeamId === "")
      return null;
    return gbTeamGameMap.get(String(gbTeamId)) || null;
  }

  /** 查询某 canonical team 在指定数据源下的 ID */
  function lookupProviderId(teamId: OptionalIdentityId, provider: string) {
    const tid = String(teamId);
    const p = String(provider || "").trim();
    if (!p)
      return null;
    for (const row of providerIdMap.get(tid) || []) {
      if (row.provider === p)
        return row.provider_id ?? null;
    }
    return null;
  }

  return {
    lookupByName,
    lookupById,
    lookupCanonicalName,
    lookupGbTeamIdByNormalizedName,
    lookupGbTeamIdByNormalizedNameForGame,
    lookupGameForGbTeamId,
    lookupProviderId,
    saveMapping,
  };
}
