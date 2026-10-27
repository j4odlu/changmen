import {
  MERGE_ID_START_TIME_TOLERANCE_MS,
  MERGE_START_TIME_TOLERANCE_MS,
  startTimesCompatible,
  startTimesCompatibleStrict,
} from "@changmen/match-identity";
import { parseTitleTeams } from "@changmen/match-identity/teams/match_utils.js";
import {
  canonicalMatchKeyByIdOnly,
  canonicalMatchKeyByName,
} from "@changmen/match-identity/teams/team_key.js";
import { getGameCodeForPlatformId, resolveClientGame } from "@changmen/shared/catalog/game_catalog";
import { resolvePlatformTeamId } from "@changmen/shared/catalog/pb_team_platform_id";
import { normalizeEpochMs } from "@changmen/shared/time/match_time";

/**
 * matchMerge 前：将 match_id 为空的 platform_matches 优先挂到已有 client_matches。
 * 1) gb_team_id 键（match:id:…）— 两队均有映射时不再回落队名
 * 2) 队名归一 + 开赛时间 ±15 分钟（match:name:…）
 * 命中后在内存写入 ClientMatchId，后续走 applyManualMatchLinks。
 *
 * clientRows 应使用 fetchClientMatchesForAlign。
 */

function findPlatformMatch(matches, provider, sourceMatchId) {
  const sid = String(sourceMatchId);
  const byId = matches?.[provider];
  if (!byId)
    return null;
  if (byId[sid])
    return byId[sid];
  return Object.values(byId).find(m => String(m.SourceMatchID) === sid) || null;
}

function platformMatchLinked(match) {
  const cid = match?.ClientMatchId ?? match?.client_match_id ?? match?.match_id;
  return cid != null && cid !== "";
}

function matchTeamIdsForLookup(platform, match, gameCode) {
  const sourceGameId = match.SourceGameID ?? match.GameID;
  return {
    homeId: resolvePlatformTeamId(platform, match.HomeID, sourceGameId, gameCode),
    awayId: resolvePlatformTeamId(platform, match.AwayID, sourceGameId, gameCode),
  };
}

function pushClientToIndex(bucket, cm) {
  const id = Number(cm.id);
  if (!bucket.some(row => Number(row.id) === id))
    bucket.push(cm);
}

function resolveClientMatchIdKey(cm, matches) {
  const stored = String(cm.merge_key || "");
  if (stored.startsWith("match:id:"))
    return stored;

  for (const [platform, srcId] of Object.entries(cm.matchs || {})) {
    const m = findPlatformMatch(matches, platform, srcId);
    if (!m)
      continue;
    const { GameID } = resolveClientGame(platform, m.SourceGameID ?? m.GameID);
    const gameCode = getGameCodeForPlatformId(platform, m.SourceGameID ?? m.GameID);
    const { homeId, awayId } = matchTeamIdsForLookup(platform, m, gameCode);
    const ck = canonicalMatchKeyByIdOnly(
      GameID,
      m.Home,
      m.Away,
      gameCode,
      { provider: platform, homeId, awayId },
    );
    if (ck)
      return ck.key;
  }
  return null;
}

function resolveClientMatchNameKey(cm, matches) {
  const stored = String(cm.merge_key || "");
  if (stored.startsWith("match:name:"))
    return stored;

  for (const [platform, srcId] of Object.entries(cm.matchs || {})) {
    const m = findPlatformMatch(matches, platform, srcId);
    if (!m)
      continue;
    const { GameID } = resolveClientGame(platform, m.SourceGameID ?? m.GameID);
    const ck = canonicalMatchKeyByName(GameID, m.Home, m.Away);
    if (ck)
      return ck.key;
  }

  const teams = parseTitleTeams(cm.title || cm.Title || "");
  if (teams) {
    const gameId = String(cm.game_id ?? cm.GameID ?? "");
    const ck = canonicalMatchKeyByName(gameId, teams.home, teams.away);
    if (ck)
      return ck.key;
  }
  return null;
}

function stripTimeSuffix(key) {
  const at = key.indexOf("@");
  return at > 0 ? key.slice(0, at) : key;
}

function isEndedClientMatchRow(row) {
  const ended = row?.ended_at ?? row?.endedAt;
  return ended != null && ended !== "";
}

function buildClientMatchIndexes(clientRows, matches) {
  const byIdKey = new Map();
  const byNameKey = new Map();

  for (const cm of clientRows || []) {
    // M4：align 不得挂到 sticky ended（与 identity 复用索引一致）
    if (isEndedClientMatchRow(cm))
      continue;
    const stored = String(cm.merge_key || "");
    if (stored.startsWith("match:id:")) {
      if (!byIdKey.has(stored))
        byIdKey.set(stored, []);
      pushClientToIndex(byIdKey.get(stored), cm);
      const base = stripTimeSuffix(stored);
      if (base !== stored) {
        if (!byIdKey.has(base))
          byIdKey.set(base, []);
        pushClientToIndex(byIdKey.get(base), cm);
      }
    }

    const idKey = resolveClientMatchIdKey(cm, matches);
    if (idKey) {
      if (!byIdKey.has(idKey))
        byIdKey.set(idKey, []);
      pushClientToIndex(byIdKey.get(idKey), cm);
      const base = stripTimeSuffix(idKey);
      if (base !== idKey) {
        if (!byIdKey.has(base))
          byIdKey.set(base, []);
        pushClientToIndex(byIdKey.get(base), cm);
      }
    }
    const nameKey = resolveClientMatchNameKey(cm, matches);
    if (nameKey) {
      if (!byNameKey.has(nameKey))
        byNameKey.set(nameKey, []);
      pushClientToIndex(byNameKey.get(nameKey), cm);
    }
  }
  return { byIdKey, byNameKey };
}

/** match:id 键 → client_matches.id（供 resolveClientMatchIds 在合并后复用） */
function buildExistingClientIdKeyIndex(clientRows, matches) {
  const map = new Map();
  for (const cm of clientRows || []) {
    // M3：已结束行不进复用索引，避免同队下场复用 sticky ended id
    if (isEndedClientMatchRow(cm))
      continue;
    const id = Number(cm.id);
    if (!Number.isFinite(id))
      continue;

    const stored = String(cm.merge_key || "");
    if (stored.startsWith("match:id:") && !map.has(stored)) {
      map.set(stored, id);
      const base = stripTimeSuffix(stored);
      if (base !== stored && !map.has(base))
        map.set(base, id);
    }
    const idKey = resolveClientMatchIdKey(cm, matches);
    if (idKey && !map.has(idKey)) {
      map.set(idKey, id);
      const base = stripTimeSuffix(idKey);
      if (base !== idKey && !map.has(base))
        map.set(base, id);
    }
  }
  return map;
}

function canAlignPlatformToClient(platform, sourceMatchId, cm) {
  const slot = cm.matchs?.[platform];
  if (slot != null && slot !== "" && String(slot) !== String(sourceMatchId))
    return false;
  return true;
}

function pickBestClientMatch(candidates, platformStartMs) {
  if (!candidates?.length)
    return null;
  if (candidates.length === 1)
    return candidates[0];

  let best = candidates[0];
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const cm of candidates) {
    const cmStart = normalizeEpochMs(cm.start_time ?? cm.StartTime);
    const delta = cmStart && platformStartMs
      ? Math.abs(cmStart - platformStartMs)
      : Number.POSITIVE_INFINITY;
    if (delta < bestDelta || (delta === bestDelta && Number(cm.id) < Number(best.id))) {
      best = cm;
      bestDelta = delta;
    }
  }
  return best;
}

function assignClientMatchId(match, clientMatchId) {
  const id = Number(clientMatchId);
  match.ClientMatchId = id;
  match.client_match_id = id;
  match.match_id = id;
}

function alignOnePlatformMatch(match, platform, indexes, stats) {
  if (platformMatchLinked(match))
    return;

  const sourceMatchId = String(match.SourceMatchID);
  const startMs = normalizeEpochMs(match.StartTime);
  const { GameID } = resolveClientGame(platform, match.SourceGameID ?? match.GameID);
  const gameCode = getGameCodeForPlatformId(platform, match.SourceGameID ?? match.GameID);
  const gameId = String(GameID || "");

  const { homeId, awayId } = matchTeamIdsForLookup(platform, match, gameCode);
  const idCk = canonicalMatchKeyByIdOnly(
    GameID,
    match.Home,
    match.Away,
    gameCode,
    { provider: platform, homeId, awayId },
  );
  if (idCk) {
    const candidates = (indexes.byIdKey.get(idCk.key) || [])
      .filter(cm => String(cm.game_id ?? "") === gameId)
      .filter(cm => startTimesCompatible(startMs, cm.start_time ?? cm.StartTime))
      .filter(cm => canAlignPlatformToClient(platform, sourceMatchId, cm));
    const hit = pickBestClientMatch(candidates, startMs);
    if (hit) {
      assignClientMatchId(match, hit.id);
      stats.alignedById++;
    }
    return;
  }

  const nameCk = canonicalMatchKeyByName(GameID, match.Home, match.Away);
  if (!nameCk)
    return;

  const candidates = (indexes.byNameKey.get(nameCk.key) || [])
    .filter(cm => String(cm.game_id ?? "") === gameId)
    .filter(cm => startTimesCompatibleStrict(startMs, cm.start_time ?? cm.StartTime))
    .filter(cm => canAlignPlatformToClient(platform, sourceMatchId, cm));
  const hit = pickBestClientMatch(candidates, startMs);
  if (!hit)
    return;

  assignClientMatchId(match, hit.id);
  stats.alignedByName++;
}

/**
 * @param {Record<string, Record<string, object>>} matches normalizeMatchesShape 产物
 * @param {object[]} clientRows fetchClientMatchesForAlign 产物
 * @returns {{ alignedById: number, alignedByName: number }}
 */
function alignUnmatchedToClientMatches(matches, clientRows) {
  const stats = { alignedById: 0, alignedByName: 0 };
  if (!clientRows?.length || !matches)
    return stats;

  const indexes = buildClientMatchIndexes(clientRows, matches);

  for (const [platform, byId] of Object.entries(matches)) {
    if (!byId || typeof byId !== "object")
      continue;
    for (const match of Object.values(byId)) {
      if (!match?.SourceMatchID)
        continue;
      alignOnePlatformMatch(match, platform, indexes, stats);
    }
  }

  return stats;
}

export {
  alignUnmatchedToClientMatches,
  buildExistingClientIdKeyIndex,
  MERGE_ID_START_TIME_TOLERANCE_MS,
  MERGE_START_TIME_TOLERANCE_MS,
  resolveClientMatchIdKey,
  resolveClientMatchNameKey,
};
