/**
 * 将 platform_matches 归一成可聚类条目。
 */
import {
  canonicalMatchKeyByIdOnly,
  canonicalMatchKeyByName,
  lookupGbTeamIdByPlatform,
  normalizeTeam,
} from "@changmen/shared/match-identity/teams/team_key.js";
import { isPlaceholderTeamName } from "@changmen/shared/match-identity/teams/match_utils.js";
import {
  getGameCodeForPlatformId,
  resolveClientGame,
} from "@changmen/shared/catalog/game_catalog";
import { resolvePlatformTeamId } from "@changmen/shared/catalog/pb_team_platform_id";
import { normalizeEpochMs } from "../util/time.js";

export function collectPlatformEntries(matches) {
  const entries = [];
  for (const [platform, bucket] of Object.entries(matches || {})) {
    if (!bucket || typeof bucket !== "object")
      continue;
    for (const pm of Object.values(bucket)) {
      if (!pm?.SourceMatchID)
        continue;
      const sourceMatchId = String(pm.SourceMatchID);
      const sourceGameId = pm.SourceGameID ?? pm.GameID;
      const gameCode = getGameCodeForPlatformId(platform, sourceGameId);
      // 与 match_merge 一致：用 A8 规范 GameID，勿用馆原生 SourceGameID（否则跨馆键永不碰撞）
      const { Game, GameID: a8GameId } = resolveClientGame(platform, sourceGameId);
      const mergeGameId = a8GameId != null && a8GameId !== 0
        ? String(a8GameId)
        : String(gameCode || sourceGameId || "");
      const homeIdRaw = String(pm.HomeID ?? pm.home_id ?? pm.SourceHomeID ?? "").trim();
      const awayIdRaw = String(pm.AwayID ?? pm.away_id ?? pm.SourceAwayID ?? "").trim();
      const homeId = resolvePlatformTeamId(platform, homeIdRaw, sourceGameId, gameCode);
      const awayId = resolvePlatformTeamId(platform, awayIdRaw, sourceGameId, gameCode);
      const homeName = String(pm.Home ?? pm.home ?? "").trim();
      const awayName = String(pm.Away ?? pm.away ?? "").trim();
      const homeGb = homeId ? String(lookupGbTeamIdByPlatform(platform, homeId) || "").trim() || null : null;
      const awayGb = awayId ? String(lookupGbTeamIdByPlatform(platform, awayId) || "").trim() || null : null;
      const homeN = normalizeTeam(homeName);
      const awayN = normalizeTeam(awayName);
      const startMs = normalizeEpochMs(pm.StartTime);
      const linkedId = pm.ClientMatchId ?? pm.client_match_id ?? pm.match_id;
      const rotRaw = pm.RotNum ?? pm.rotNum ?? pm.rot_num;
      const rotNum = rotRaw != null ? String(rotRaw).trim() : "";
      entries.push({
        platform,
        sourceMatchId,
        homeId,
        awayId,
        homeName,
        awayName,
        homeGb,
        awayGb,
        homeN,
        awayN,
        startMs,
        gameCode,
        Game,
        GameID: mergeGameId,
        BO: Number(pm.BO) || 0,
        rotNum,
        nativeRow: pm,
        rowKey: `${platform}:${sourceMatchId}`,
        clientMatchId: linkedId != null && linkedId !== "" ? Number(linkedId) : null,
      });
    }
  }
  return entries;
}

export function canUseIdKey(entry) {
  if (!entry.homeGb || !entry.awayGb || entry.homeGb === entry.awayGb)
    return false;
  if (!entry.homeN || !entry.awayN)
    return false;
  if (isPlaceholderTeamName(entry.homeN) || isPlaceholderTeamName(entry.awayN))
    return false;
  return true;
}

export function canUseNameKey(entry) {
  if (!entry.homeN || !entry.awayN)
    return false;
  if (isPlaceholderTeamName(entry.homeN) || isPlaceholderTeamName(entry.awayN))
    return false;
  return true;
}

/** MergeKey 格式：match:id:GameID:gb:gb */
export function pairKeyId(entry) {
  const ck = canonicalMatchKeyByIdOnly(
    entry.GameID,
    entry.homeName,
    entry.awayName,
    entry.gameCode,
    { provider: entry.platform, homeId: entry.homeId, awayId: entry.awayId },
  );
  if (ck?.mergeKey)
    return ck.mergeKey;
  if (!entry.homeGb || !entry.awayGb)
    return null;
  const a = entry.homeGb;
  const b = entry.awayGb;
  const [x, y] = a < b ? [a, b] : [b, a];
  return `match:id:${entry.GameID || ""}:${x}:${y}`;
}

/** 与 legacy 一致：match:name:GameID:name:name */
export function pairKeyName(entry) {
  const ck = canonicalMatchKeyByName(entry.GameID, entry.homeName, entry.awayName);
  if (ck?.mergeKey)
    return ck.mergeKey;
  if (!entry.homeN || !entry.awayN)
    return null;
  const a = entry.homeN;
  const b = entry.awayN;
  const [x, y] = a < b ? [a, b] : [b, a];
  return `match:name:${entry.GameID || entry.gameCode || ""}:${x}:${y}`;
}
