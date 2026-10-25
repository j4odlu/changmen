import {
  fetchClientMatchesHidden,
  fetchClientMatchesForAlign,
  fetchClientMatchesHiddenCount,
  fetchLatestClientMatchBuiltAt,
  fetchPlatformMatchesForHiddenClientMatches,
  loadTeamMapsForMatcher,
} from "@changmen/db";
import { normalizeTeam } from "@changmen/shared/match-identity/teams/team_key.js";
import { normalizeEpochMs } from "@changmen/shared/time/match_time";
import { formatPmMatchStatus } from "./pm_match_status.js";
import { isComposerStickyOrientation } from "../lib/config.js";
import { normalizeMatchesShape } from "../compose/io/snapshot.js";
import { isMatcherProduction, MATCHER_INTERVAL_MS } from "../lib/config.js";
import { resolveUiGame } from "../lib/game_ui.js";
import {
  isMatcherRunning,
  readMatcherHeartbeat,
  sanitizeMatcherHeartbeat,
  STALE_FACTOR,
} from "../lib/heartbeat.js";
import { fetchMatcherRdsSnapshot } from "../ops/rds_snapshot_cache.js";
import { readRayRiskIds } from "../ray_match_risk.js";
import {
  getEmbeddedMatcherState,
  isManagedByServer,
} from "./matcher_process.js";
import { enrichClientMatchesMergeMode } from "./merge_mode.js";
import { buildEndedSourceOwners, isEndedClientMatch } from "../lib/match_lifecycle.js";

function recommendationGroupKey(m) {
  const game = resolveUiGame(m.platform, m.source_game_id);
  if (!game)
    return null;
  const h = normalizeTeam(m.home);
  const a = normalizeTeam(m.away);
  if (!h || !a)
    return null;
  const bucket = Math.round(normalizeEpochMs(m.start_time) / (30 * 60 * 1000));
  const [t1, t2] = h <= a ? [h, a] : [a, h];
  return { key: `${game.code}:${bucket}:${t1}:${t2}`, game, t1, t2 };
}

function boundClientMatchId(m) {
  const raw = m?.bound_client_match_id ?? m?.match_id;
  if (raw == null || raw === "")
    return null;
  const id = Number(raw);
  return Number.isFinite(id) ? id : null;
}

/** 已挂到任意 client_match（含 ended_at）则不算推荐候选 */
function isPlatformMatchLinkedForRec(m, clientMatches, platforms = null) {
  if (boundClientMatchId(m) != null)
    return true;
  const visibleClientMatches = filterVisibleClientMatches(clientMatches, platforms);
  return visibleClientMatches.some(
    cm => String(cm.matchs?.[m.platform] ?? "") === String(m.source_match_id),
  );
}

function filterVisibleClientMatches(clientMatches, platforms = null) {
  return (clientMatches || []).filter((cm) => {
    if (Object.keys(cm.matchs || {}).length < 2)
      return false;
    if (!platforms)
      return true;
    let live = 0;
    for (const [plat, srcId] of Object.entries(cm.matchs || {})) {
      const list = platforms[plat] || [];
      if (list.some(m => String(m.source_match_id) === String(srcId)))
        live++;
    }
    return live >= 1;
  });
}

function resolveVisibleClientMatchId(m, clientMatches, platforms = null) {
  const visibleClientMatches = filterVisibleClientMatches(clientMatches, platforms);
  if (m?.match_id != null && m.match_id !== "") {
    const directId = Number(m.match_id);
    if (visibleClientMatches.some(cm => Number(cm.id) === directId))
      return directId;
  }
  const cm = visibleClientMatches.find(
    row => String(row.matchs?.[m.platform] ?? "") === String(m.source_match_id),
  );
  return cm ? Number(cm.id) : null;
}

function platformsIndexFromMatchRows(allMatches) {
  const byPlatform = {};
  for (const m of allMatches || []) {
    if (!byPlatform[m.platform])
      byPlatform[m.platform] = [];
    byPlatform[m.platform].push(m);
  }
  return byPlatform;
}

function computeRecommendations(allMatches, clientMatches = []) {
  const platforms = platformsIndexFromMatchRows(allMatches);
  const groups = new Map();

  for (const m of allMatches) {
    if (m.ended_client_match_id != null) continue;
    const gk = recommendationGroupKey(m);
    if (!gk)
      continue;
    if (!groups.has(gk.key))
      groups.set(gk.key, { game: gk.game, t1: gk.t1, t2: gk.t2, matches: [] });
    groups.get(gk.key).matches.push(m);
  }

  return [...groups.values()]
    .filter(g => new Set(g.matches.map(m => m.platform)).size >= 2)
    .filter(g => g.matches.some(m => !isPlatformMatchLinkedForRec(m, clientMatches, platforms)))
    .map((g) => {
      const platformsList = [...new Set(g.matches.map(m => m.platform))];
      const times = g.matches.map(m => normalizeEpochMs(m.start_time)).filter(t => t > 0);
      const startTime = times.length ? Math.min(...times) : 0;
      const timeDiffMs = times.length > 1 ? Math.max(...times) - Math.min(...times) : 0;
      let confidence = 0.6 + (platformsList.length - 2) * 0.1;
      if (timeDiffMs < 5 * 60 * 1000)
        confidence += 0.2;
      else if (timeDiffMs < 15 * 60 * 1000)
        confidence += 0.1;
      return {
        game: g.game,
        t1: g.t1,
        t2: g.t2,
        platforms: platformsList,
        startTime,
        timeDiffMs,
        confidence: Math.min(confidence, 1.0),
        matches: g.matches,
      };
    })
    .sort((a, b) => a.startTime - b.startTime);
}

async function getMatcherStatus() {
  const now = Date.now();
  const heartbeat = sanitizeMatcherHeartbeat(readMatcherHeartbeat());
  const intervalMs = heartbeat?.intervalMs || MATCHER_INTERVAL_MS;
  const thresholdMs = intervalMs * STALE_FACTOR;

  let processRunning = false;
  let processSource = "none";
  let pid = null;
  let matchCount = heartbeat?.matchCount ?? null;
  let processLastRun = null;
  let processAgeMs = null;

  const embeddedState = getEmbeddedMatcherState();
  if (embeddedState.running) {
    processRunning = true;
    processSource = "embedded";
    pid = embeddedState.pid;
    processLastRun = heartbeat?.lastRun || now;
    processAgeMs = heartbeat?.lastRun ? now - heartbeat.lastRun : 0;
  }
  else if (isMatcherRunning(heartbeat, now)) {
    processRunning = true;
    processSource = "heartbeat";
    pid = heartbeat.pid;
    matchCount = heartbeat.matchCount;
    processLastRun = heartbeat.lastRun;
    processAgeMs = now - heartbeat.lastRun;
  }

  const lastBuilt = await fetchLatestClientMatchBuiltAt();
  const dataAgeMs = lastBuilt ? now - lastBuilt : null;
  const dataFresh = !!(lastBuilt && dataAgeMs <= thresholdMs);

  return {
    processRunning,
    processSource,
    dataFresh,
    lastBuiltAt: lastBuilt || null,
    dataAgeMs,
    processLastRun,
    processAgeMs,
    intervalMs,
    matchCount,
    pid,
    matcherMode: "embedded",
    managedByServer: isManagedByServer(),
    canStop: embeddedState.running && !isMatcherProduction(),
    canStart: !processRunning,
    running: processRunning,
    writer: "composer",
    sideEngine: "composer",
    stickyOrientation: isComposerStickyOrientation(),
    composerUiPort: Number(process.env.COMPOSER_UI_PORT || 4568) || 4568,
    source: processRunning
      ? processSource
      : dataFresh
        ? "data_only"
        : heartbeat?.lastRun
          ? "heartbeat_stale"
          : lastBuilt
            ? "data_stale"
            : "none",
    lastRun: processLastRun || lastBuilt || null,
    ageMs: processRunning ? processAgeMs : dataAgeMs,
  };
}

function normalizeDashboardStartTime(row) {
  return { ...row, start_time: normalizeEpochMs(row.start_time) };
}

/** [changmen 扩展] 展示用户页同源 PM 状态；不推断比赛生命周期。 */
export function clientMatchWithPmStatus(row) {
  const snapshot = row.pm_sport;
  const hasPm = snapshot || row.matchs?.Polymarket;
  return {
    ...normalizeDashboardStartTime(row),
    pm_match_status: hasPm ? formatPmMatchStatus(snapshot || undefined) : null,
  };
}

function firstValue(...values) {
  return values.find(v => v != null && v !== "");
}

/** @returns {boolean|null} */
function normalizeIsLiveFlag(...values) {
  for (const raw of values) {
    if (raw === true || raw === 1 || raw === "1")
      return true;
    if (raw === false || raw === 0 || raw === "0")
      return false;
    if (typeof raw === "string") {
      const s = raw.trim().toLowerCase();
      if (s === "true")
        return true;
      if (s === "false")
        return false;
    }
  }
  return null;
}

function dashboardRowsFromSnapshot(matchesRaw, clientMatches, lifecycleRows = []) {
  const normalized = normalizeMatchesShape(matchesRaw);
  const endedOwners = buildEndedSourceOwners(lifecycleRows);
  const endedIds = new Set(lifecycleRows.filter(isEndedClientMatch).map(row => Number(row.id ?? row.ID)));
  // 用当前快照建平台索引，过滤掉挂载已全部失效的僵尸 client_matches
  const livePlatformIndex = {};
  for (const [platform, byId] of Object.entries(normalized || {})) {
    livePlatformIndex[platform] = Object.values(byId || {}).map(m => ({
      source_match_id: String(firstValue(m.SourceMatchID, m.source_match_id) ?? ""),
    })).filter(r => r.source_match_id);
  }
  const activeClientIds = new Set(
    filterVisibleClientMatches(clientMatches, livePlatformIndex)
      .map(cm => Number(cm.id))
      .filter(Number.isFinite),
  );
  const rows = [];

  for (const [platform, byId] of Object.entries(normalized || {})) {
    for (const m of Object.values(byId || {})) {
      const sourceMatchId = firstValue(m.SourceMatchID, m.source_match_id);
      if (sourceMatchId == null)
        continue;
      const rawMatchId = firstValue(m.ClientMatchId, m.client_match_id, m.match_id, endedOwners.get(`${platform}:${sourceMatchId}`));
      const boundId = rawMatchId != null && rawMatchId !== ""
        ? Number(rawMatchId)
        : null;
      const boundCmId = Number.isFinite(boundId) ? boundId : null;
      // 左/中栏只认活跃多馆场；bound 保留已结束挂载，避免推荐组/未匹配幽灵
      const matchId = boundCmId != null && activeClientIds.has(boundCmId)
        ? boundCmId
        : null;
      rows.push({
        platform,
        source_match_id: String(sourceMatchId),
        source_game_id: firstValue(m.SourceGameID, m.source_game_id, ""),
        start_time: Number(firstValue(m.StartTime, m.start_time, 0)) || 0,
        home: firstValue(m.Home, m.home, ""),
        home_id: firstValue(m.HomeID, m.home_id, ""),
        away: firstValue(m.Away, m.away, ""),
        away_id: firstValue(m.AwayID, m.away_id, ""),
        bo: Number(firstValue(m.BO, m.bo, 0)) || 0,
        match_id: matchId,
        bound_client_match_id: boundCmId,
        ended_client_match_id: endedIds.has(boundCmId) ? boundCmId : null,
        synced_at: Number(firstValue(m.savedAt, m.synced_at, 0)) || 0,
        rot_num: String(firstValue(m.RotNum, m.rotNum, m.rot_num, "") || "").trim() || "",
        is_live: normalizeIsLiveFlag(m.IsLive, m.isLive, m.is_live, m.live),
        teams: Array.isArray(m.Teams) ? m.Teams : (Array.isArray(m.teams) ? m.teams : []),
      });
    }
  }

  return rows.sort((a, b) => normalizeEpochMs(a.start_time) - normalizeEpochMs(b.start_time));
}

function summarizeMatcherDashboard(data) {
  const platformRows = Object.values(data?.platforms || {}).flat();
  const clientMatches = data?.clientMatches || [];
  const visibleClientMatches = filterVisibleClientMatches(clientMatches, data?.platforms);
  const recKeys = new Set();
  for (const rec of data?.recommendations || []) {
    for (const m of rec.matches || [])
      recKeys.add(`${m.platform}:${m.source_match_id}`);
  }

  const byPlatform = {};
  const unmatchedSamples = [];
  const linkedSamples = [];
  let linked = 0;
  let unmatched = 0;
  let inRecommendation = 0;

  for (const m of platformRows) {
    if (!byPlatform[m.platform])
      byPlatform[m.platform] = { total: 0, linked: 0, unmatched: 0, inRecommendation: 0 };
    const bucket = byPlatform[m.platform];
    bucket.total++;
    const cmId = resolveVisibleClientMatchId(m, clientMatches, data?.platforms);
    const recKey = `${m.platform}:${m.source_match_id}`;
    const recHit = recKeys.has(recKey);
    if (recHit) {
      inRecommendation++;
      bucket.inRecommendation++;
    }
    if (cmId != null) {
      linked++;
      bucket.linked++;
      if (linkedSamples.length < 8) {
        linkedSamples.push({
          platform: m.platform,
          source_match_id: m.source_match_id,
          client_match_id: cmId,
          home: m.home,
          away: m.away,
        });
      }
    }
    else {
      unmatched++;
      bucket.unmatched++;
      if (unmatchedSamples.length < 12) {
        unmatchedSamples.push({
          platform: m.platform,
          source_match_id: m.source_match_id,
          home: m.home,
          away: m.away,
          inRecommendation: recHit,
        });
      }
    }
  }

  return {
    platformMatches: platformRows.length,
    clientMatches: clientMatches.length,
    visibleClientMatches: visibleClientMatches.length,
    recommendations: data?.recommendations?.length || 0,
    linkedPlatformMatches: linked,
    unmatchedPlatformMatches: unmatched,
    inRecommendation,
    byPlatform,
    samples: {
      unmatched: unmatchedSamples,
      linked: linkedSamples,
    },
  };
}

/** 仅补充运维展示资料；不调用过滤函数，也不改写赛事、盘口或异常记录。 */
export function buildRayRiskMatches(ids, clientMatches, rayMatches) {
  return ids.map((id) => {
    const native = rayMatches.find(row => String(row.source_match_id) === id);
    const cm = clientMatches.find(row => String(row.matchs?.RAY ?? "") === id)
      || clientMatches.find(row => native?.match_id != null && Number(row.id) === Number(native.match_id));
    const title = cm?.title || (native?.home && native?.away ? `${native.home} vs ${native.away}` : "");
    return {
      rayMatchId: id,
      clientMatchId: cm?.id ?? null,
      title: title || `RAY 比赛 #${id}`,
      startTime: normalizeEpochMs(cm?.start_time || native?.start_time),
      detailsAvailable: Boolean(title),
    };
  });
}

async function fetchMatcherDashboard() {
  const [snapshot, hiddenClientMatchCount, lifecycleRows] = await Promise.all([
    fetchMatcherRdsSnapshot(),
    fetchClientMatchesHiddenCount(),
    fetchClientMatchesForAlign(),
  ]);
  const clientMatchesRaw = snapshot.clientRows || [];
  if (!lifecycleRows) throw new Error("比赛关联读取失败，无法确认已结束来源");
  const allMatchesRaw = dashboardRowsFromSnapshot(snapshot.matchesRaw, clientMatchesRaw, lifecycleRows);

  const clientMatchesNorm = (clientMatchesRaw || []).map(clientMatchWithPmStatus);

  const gameByPlatformMatch = new Map();
  for (const cm of clientMatchesNorm) {
    const code = typeof cm.game === "string" ? cm.game : cm.game?.code;
    if (!code)
      continue;
    for (const [plat, srcId] of Object.entries(cm.matchs || {})) {
      gameByPlatformMatch.set(`${plat}:${srcId}`, code);
    }
  }

  const allMatches = (allMatchesRaw || []).map((row) => {
    const normalized = normalizeDashboardStartTime(row);
    const gameFromCm = gameByPlatformMatch.get(`${normalized.platform}:${normalized.source_match_id}`);
    const uiGame
      = resolveUiGame(normalized.platform, normalized.source_game_id)
        || (gameFromCm ? { code: gameFromCm, name: gameFromCm } : null);
    return { ...normalized, game: uiGame };
  });
  const recommendations = computeRecommendations(allMatches, clientMatchesNorm);

  const recByKey = new Map();
  for (const rec of recommendations) {
    for (const m of rec.matches) {
      recByKey.set(`${m.platform}:${m.source_match_id}`, {
        confidence: rec.confidence,
        partners: rec.platforms.filter(p => p !== m.platform),
      });
    }
  }

  const byPlatform = {};
  for (const m of allMatches) {
    const enriched = {
      ...m,
      game: m.game || resolveUiGame(m.platform, m.source_game_id),
      rec: recByKey.get(`${m.platform}:${m.source_match_id}`) || null,
    };
    if (!byPlatform[m.platform])
      byPlatform[m.platform] = [];
    byPlatform[m.platform].push(enriched);
  }

  const teamMaps = await loadTeamMapsForMatcher(allMatches);
  const clientMatches = await enrichClientMatchesMergeMode(clientMatchesNorm, byPlatform, teamMaps);

  const dashboard = {
    platforms: byPlatform,
    clientMatches,
    rayRiskMatches: buildRayRiskMatches(readRayRiskIds(), clientMatches, byPlatform.RAY || []),
    hiddenClientMatches: [],
    hiddenClientMatchCount,
    recommendations,
    teamMaps,
    updatedAt: Date.now(),
  };
  dashboard.debug = summarizeMatcherDashboard(dashboard);
  return dashboard;
}

async function fetchMatcherHiddenClientMatches() {
  const [rows, count] = await Promise.all([
    fetchClientMatchesHidden(),
    fetchClientMatchesHiddenCount(),
  ]);
  const clientRows = (rows || []).map(clientMatchWithPmStatus);
  const venueRows = await fetchPlatformMatchesForHiddenClientMatches(clientRows);
  const byPlatform = {};
  for (const raw of venueRows || []) {
    const normalized = normalizeDashboardStartTime({
      ...raw,
      platform: String(raw.platform || ""),
      source_match_id: String(raw.source_match_id ?? ""),
      source_game_id: firstValue(raw.source_game_id, ""),
      home: firstValue(raw.home, ""),
      home_id: firstValue(raw.home_id, ""),
      away: firstValue(raw.away, ""),
      away_id: firstValue(raw.away_id, ""),
      bo: Number(raw.bo) || 0,
      match_id: raw.match_id != null ? Number(raw.match_id) : null,
      rot_num: String(firstValue(raw.rot_num, raw.RotNum, raw.rotNum, "") || "").trim() || "",
      is_live: normalizeIsLiveFlag(raw.is_live, raw.IsLive, raw.isLive, raw.live),
      teams: Array.isArray(raw.teams) ? raw.teams : [],
    });
    const game = resolveUiGame(normalized.platform, normalized.source_game_id);
    const enriched = { ...normalized, game: game || null };
    if (!byPlatform[enriched.platform])
      byPlatform[enriched.platform] = [];
    byPlatform[enriched.platform].push(enriched);
  }
  const teamMaps = await loadTeamMapsForMatcher(
    Object.values(byPlatform).flat(),
  );
  return {
    hiddenClientMatches: clientRows,
    hiddenClientMatchCount: count,
    hiddenPlatforms: byPlatform,
    teamMaps,
    updatedAt: Date.now(),
  };
}

export {
  boundClientMatchId,
  computeRecommendations,
  dashboardRowsFromSnapshot,
  fetchMatcherDashboard,
  fetchMatcherHiddenClientMatches,
  getMatcherStatus,
  isPlatformMatchLinkedForRec,
  summarizeMatcherDashboard,
};
