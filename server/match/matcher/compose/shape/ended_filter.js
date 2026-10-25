/**
 * 已结束场剔除（逻辑对齐 match_lifecycle，不 import merge）。
 *
 * 有 PM：身份一致且 PM 确认结束即结束整场，不等待其它场馆。
 * 仅 OB：原 Round/timer/锁盘/is_live 逻辑。
 */
import { normalizeEpochMs } from "@changmen/shared/time/match_time";
import { findPlatformMatch } from "../sides/orientation_lock.js";
import { liveRound } from "../structure/resolve_structure.js";
import { buildEndedSourceOwners } from "../../lib/match_lifecycle.js";

const PAST_START_FALLBACK_MS = 30 * 60 * 1000;
export const ALL_SOURCES_GONE_MS = 3 * 60 * 1000;

function isInLiveTimer(matchs, timersByProvider) {
  for (const [provider, sourceId] of Object.entries(matchs || {})) {
    const hit = liveRound(timersByProvider, provider, sourceId);
    if (hit.round > 0)
      return true;
  }
  return false;
}

function pickCanonicalIsLive(matchs, platformMatches) {
  const order = ["Polymarket", "OB", "RAY", "IA", "PB", "TF"];
  const linked = Object.entries(matchs || {})
    .map(([provider, sourceId]) => ({
      provider,
      sourceId: String(sourceId),
      pri: order.indexOf(provider) >= 0 ? 100 - order.indexOf(provider) : 0,
    }))
    .sort((a, b) => b.pri - a.pri);
  for (const { provider, sourceId } of linked) {
    const pm = findPlatformMatch(platformMatches, provider, sourceId);
    if (!pm)
      continue;
    const raw = pm.IsLive ?? pm.is_live;
    if (raw != null && raw !== "")
      return Number(raw);
  }
  return null;
}

export function allMapBetsClosed(bets) {
  const list = bets || [];
  const full = list.find(b => (Number(b.Map) || 0) === 0);
  if (full) {
    const fullSources = Object.values(full.Sources || {});
    if (fullSources.length && fullSources.some(s => String(s?.Status || "Normal") === "Normal"))
      return false;
  }
  const mapBets = list.filter(b => (Number(b.Map) || 0) > 0);
  if (!mapBets.length)
    return false;
  for (const bet of mapBets) {
    const sources = Object.values(bet.Sources || {});
    if (!sources.length)
      return false;
    if (sources.some(s => String(s?.Status || "Normal") === "Normal"))
      return false;
  }
  return true;
}

export function allPlatformSourcesGone(matchs, platformMatches) {
  const providers = Object.entries(matchs || {});
  if (!providers.length)
    return true;
  for (const [provider, sourceId] of providers) {
    if (findPlatformMatch(platformMatches, provider, sourceId))
      return false;
  }
  return true;
}

function isPmSportEnded(pmSport) {
  if (!pmSport || typeof pmSport !== "object")
    return false;
  if (pmSport.ended === true)
    return true;
  const st = String(pmSport.status || "").toLowerCase();
  return st === "finished" || st === "final";
}

export function pmSportMatchesLink(link, pmSport) {
  const key = String(link ?? "").trim();
  if (!key || !pmSport || typeof pmSport !== "object")
    return false;
  const candidates = [
    pmSport.slug,
    pmSport.eventId,
    pmSport.event_id,
    pmSport.id,
  ];
  for (const c of candidates) {
    if (c != null && String(c).trim() === key)
      return true;
  }
  return false;
}

function isPmConfirmEnded(link, pmSport, startMs, now) {
  if (!pmSportMatchesLink(link, pmSport))
    return false;
  if (!isPmSportEnded(pmSport))
    return false;
  if (!(startMs > 0 && startMs <= now))
    return false;
  return true;
}

export function isClientMatchPmEnded(row, pmSport = row?.pm_sport ?? row?.PmSport, now = Date.now()) {
  const link = (row?.Matchs ?? row?.matchs)?.Polymarket;
  return isPmConfirmEnded(link, pmSport, normalizeEpochMs(row?.StartTime ?? row?.start_time), now);
}

/** 历史诊断入口：所有已结束来源均保留归属；生产匹配使用 matchingPlatformSources。 */
export function buildEndedSourceTombstones(clientRows) {
  return new Set(buildEndedSourceOwners(clientRows).keys());
}

/**
 * 历史 ended 行上、已确认结束的 pm_sport，按 Polymarket eventId 索引。
 * 新活跃行 pm_sport 为空时，endPass 可跨行认终态（防幽灵复活）。
 */
export function buildEndedPmSportByPolymarketLink(clientRows) {
  const out = new Map();
  for (const row of clientRows || []) {
    const ended = row?.ended_at ?? row?.endedAt;
    if (ended == null || ended === "")
      continue;
    const pmSport = row?.pm_sport ?? row?.PmSport;
    if (!isPmSportEnded(pmSport))
      continue;
    const matchs = row?.matchs ?? row?.Matchs ?? {};
    const link = matchs?.Polymarket;
    if (link == null || link === "")
      continue;
    if (!pmSportMatchesLink(link, pmSport))
      continue;
    const key = String(link).trim();
    const endedMs = Number(ended) || 0;
    const prev = out.get(key);
    if (!prev || endedMs >= (Number(prev._endedAt) || 0))
      out.set(key, { ...pmSport, _endedAt: endedMs });
  }
  return out;
}

export function isClientMatchEnded(row, platformMatches, timersByProvider, now = Date.now(), pmSport = null) {
  const startMs = normalizeEpochMs(row?.StartTime);

  if (startMs > 0 && startMs <= now - ALL_SOURCES_GONE_MS
    && allPlatformSourcesGone(row?.Matchs, platformMatches)) {
    return true;
  }

  const hasPm = row?.Matchs?.Polymarket != null && row.Matchs.Polymarket !== "";
  const hasOb = row?.Matchs?.OB != null && row.Matchs.OB !== "";
  const pmLink = row?.Matchs?.Polymarket;

  if (hasPm)
    return isPmConfirmEnded(pmLink, pmSport, startMs, now);

  if (Number(row?.Round) > 0)
    return false;
  if (isInLiveTimer(row?.Matchs, timersByProvider))
    return false;

  if (startMs > now)
    return false;

  const closed = allMapBetsClosed(row?.Bets);
  const isLive = hasOb ? pickCanonicalIsLive(row?.Matchs, platformMatches) : null;

  if (hasOb && isLive === 2)
    return false;

  if (startMs <= now && closed)
    return true;

  if (hasOb && isLive == null && startMs <= now - PAST_START_FALLBACK_MS)
    return true;

  return false;
}

export function buildPmSportByClientId(clientRowsOrMap) {
  const out = new Map();
  if (clientRowsOrMap instanceof Map) {
    for (const [id, pm] of clientRowsOrMap) {
      if (pm && typeof pm === "object")
        out.set(Number(id), pm);
    }
    return out;
  }
  for (const row of clientRowsOrMap || []) {
    const id = Number(row?.id ?? row?.ID);
    if (!Number.isFinite(id))
      continue;
    const pm = row?.pm_sport ?? row?.PmSport;
    if (pm && typeof pm === "object")
      out.set(id, pm);
  }
  return out;
}

export function filterActiveClientMatches(list, ctx = {}) {
  const {
    platformMatches = {},
    timersByProvider = {},
    pmSportByClientId,
    endedAtByClientId,
    endedPmSportByPolymarketLink,
    now = Date.now(),
  } = ctx;
  const kept = [];
  const endedList = [];
  let endedCount = 0;
  for (const row of list || []) {
    const id = Number(row?.ID ?? row?.id);
    const stickyEnded = Number.isFinite(id)
      && endedAtByClientId?.has(id)
      && endedAtByClientId.get(id) != null;
    const pmLink = row?.Matchs?.Polymarket ?? row?.matchs?.Polymarket;
    const ownPm = (Number.isFinite(id) && pmSportByClientId?.get(id))
      || row?.PmSport
      || row?.pm_sport
      || null;
    const inherited = (!ownPm && pmLink != null && pmLink !== ""
      && endedPmSportByPolymarketLink?.get(String(pmLink)))
      || null;
    const pmSport = ownPm || inherited || null;
    if (stickyEnded || isClientMatchEnded(row, platformMatches, timersByProvider, now, pmSport)) {
      endedCount++;
      endedList.push(row);
      continue;
    }
    kept.push(row);
  }
  return { list: kept, endedList, endedCount };
}

/** 从 RDS client 行构建 id → ended_at（仅已结束） */
export function buildEndedAtByClientId(clientRowsOrMap) {
  const out = new Map();
  if (clientRowsOrMap instanceof Map) {
    for (const [id, row] of clientRowsOrMap) {
      const ended = row?.ended_at ?? row?.endedAt;
      if (ended != null && ended !== "")
        out.set(Number(id), Number(ended) || ended);
    }
    return out;
  }
  for (const row of clientRowsOrMap || []) {
    const id = Number(row?.id ?? row?.ID);
    if (!Number.isFinite(id))
      continue;
    const ended = row?.ended_at ?? row?.endedAt;
    if (ended != null && ended !== "")
      out.set(id, Number(ended) || ended);
  }
  return out;
}
