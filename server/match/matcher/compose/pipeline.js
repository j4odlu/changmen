/**
 * 合场主链路（M2：Match / End 进程内拆分）：
 * align → cluster → Match(pass) → End(pass) →（写库时）存活行 insert stub
 */
import {
  alignUnmatchedToClientMatches,
  buildExistingClientIdKeyIndex,
} from "../ops/align_unmatched_to_client.js";
import {
  applyPlatformBindings,
  clusterByGbThenName,
  MIN_PLATFORMS,
} from "./cluster/merge_clusters.js";
import { dedupeRowsById } from "./ids/dedupe_rows.ts";
import { resolveIdsDryRun, resolveIdsForWrite } from "./ids/resolve_ids.js";
import {
  buildEndedAtByClientId,
  buildEndedPmSportByPolymarketLink,
  buildPmSportByClientId,
  filterActiveClientMatches,
  isClientMatchPmEnded,
} from "./shape/ended_filter.js";
import { applyLiveShape, filterMultiPlatform } from "./shape/live_shape.js";
import { projectList } from "./sides/project_sources.js";
import { resolveMatchStructure } from "./structure/resolve_structure.js";
import { matchingPlatformSources } from "../lib/match_lifecycle.js";

function isEndedClientMatchRow(row) {
  const ended = row?.ended_at ?? row?.endedAt;
  return ended != null && ended !== "";
}

function activeClientIdSet(clientRows) {
  const ids = new Set();
  for (const r of clientRows || []) {
    if (isEndedClientMatchRow(r))
      continue;
    const id = Number(r.id ?? r.ID);
    if (Number.isFinite(id) && id > 0)
      ids.add(id);
  }
  return ids;
}

function filterBindingsToActive(bindingsByClientId, activeIds) {
  if (!bindingsByClientId?.size)
    return bindingsByClientId;
  const out = new Map();
  for (const [cmId, list] of bindingsByClientId.entries()) {
    const id = Number(cmId);
    if (activeIds.has(id))
      out.set(cmId, list);
  }
  return out;
}

export function composeFromSnapshot(snapshot, opts = {}) {
  const fromVenuesOnly = !!opts.fromVenuesOnly || !!snapshot._fromVenuesOnly;
  const {
    matches: rawMatches,
    clientRows: rawClientRows,
    alignClientRows: rawAlignRows,
    platformBindingsByClientId: rawBindings,
  } = snapshot;

  const clientRows = fromVenuesOnly ? [] : (rawClientRows || []);
  const matches = fromVenuesOnly ? rawMatches : matchingPlatformSources(rawMatches, clientRows);
  const alignClientRows = fromVenuesOnly ? [] : (rawAlignRows || []);
  const activeIds = activeClientIdSet(clientRows);
  const platformBindingsByClientId = fromVenuesOnly
    ? null
    : filterBindingsToActive(rawBindings, activeIds);

  const alignRows = alignClientRows?.length ? alignClientRows : clientRows;
  const alignStats = fromVenuesOnly
    ? { skipped: true, reason: "fromVenuesOnly" }
    : alignUnmatchedToClientMatches(matches, alignRows);

  let list = clusterByGbThenName(matches, clientRows, { bets: snapshot.bets || {} });
  const bound = applyPlatformBindings(list, platformBindingsByClientId, matches, {
    bets: snapshot.bets || {},
  });
  list = bound.list;

  return {
    list,
    alignStats,
    skippedBindings: bound.skippedBindings || 0,
    fromVenuesOnly,
  };
}

/** 负/非法临时 ID 清空，供写库路径真正 insert */
function stripTempIds(rows) {
  return (rows || []).map((row) => {
    const id = Number(row.ID);
    if (Number.isFinite(id) && id > 0)
      return row;
    const next = { ...row };
    delete next.ID;
    return next;
  });
}

/**
 * Match 匹配：聚类结果 → 结构/朝向/盘口/多馆过滤。
 * 不判定 ended（M2）。
 */
export function runMatchPass(list, snapshot, opts = {}) {
  const fromVenuesOnly = !!opts.fromVenuesOnly || !!snapshot._fromVenuesOnly;
  const {
    forceReanchorOrientation = false,
    stickyOrientation,
  } = opts;
  const {
    matches: rawMatches,
    bets,
    timers,
  } = snapshot;

  const clientRows = fromVenuesOnly ? [] : (snapshot.clientRows || []);
  const matches = fromVenuesOnly ? rawMatches : matchingPlatformSources(rawMatches, clientRows);
  const alignClientRows = fromVenuesOnly ? [] : (snapshot.alignClientRows || []);
  const platformOverrides = fromVenuesOnly ? {} : (snapshot.platformOverrides || {});

  const alignRows = alignClientRows?.length ? alignClientRows : clientRows;
  const existingIdKeyIndex = fromVenuesOnly
    ? new Map()
    : buildExistingClientIdKeyIndex(alignRows, matches);

  let info = resolveIdsDryRun(list, {
    matches,
    existingClientRows: clientRows,
    existingIdKeyIndex,
  });

  const deduped = dedupeRowsById(info);
  info = deduped.list;
  const existingIds = activeClientIdSet(clientRows);
  const keepExistingSingle = r => opts.allowExistingSingle === true
    && existingIds.has(Number(r.ID)) && Object.keys(r.Matchs || {}).length >= 1;
  info = info.filter(r => Object.keys(r.Matchs || {}).length >= MIN_PLATFORMS || keepExistingSingle(r));

  resolveMatchStructure(info, { matches, timers, bets });

  const projectStats = projectList(info, {
    matches,
    bets,
    existingClientRows: clientRows,
    platformOverrides,
    forceReanchorOrientation: fromVenuesOnly ? true : forceReanchorOrientation,
    stickyOrientation: fromVenuesOnly ? false : stickyOrientation,
  });

  applyLiveShape(info, { matches });
  info = info.filter(r => keepExistingSingle(r) || filterMultiPlatform([r], MIN_PLATFORMS).length);

  const processedActiveIds = new Set(
    info.map(r => Number(r.ID)).filter(id => Number.isFinite(id) && id > 0),
  );

  return {
    info,
    projectStats,
    mergedDuplicateIds: deduped.mergedCount,
    preEndedCount: info.length,
    processedActiveIds,
    existingIdKeyIndex,
    fromVenuesOnly,
  };
}

/**
 * End 结束：仅 `ended_filter` 拆出活场 / 结束场。不改 matchs 聚类。
 */
export function runEndPass(info, snapshot, opts = {}) {
  const fromVenuesOnly = !!opts.fromVenuesOnly || !!snapshot._fromVenuesOnly;
  const matches = snapshot.matches || {};
  const timers = snapshot.timers || {};
  const clientRows = fromVenuesOnly ? [] : (snapshot.clientRows || []);

  const pmSportByClientId = fromVenuesOnly
    ? new Map()
    : buildPmSportByClientId(clientRows);
  const endedAtByClientId = fromVenuesOnly
    ? new Map()
    : buildEndedAtByClientId(clientRows);
  // 已有比赛的 PM 终态不依赖本轮聚类是否还带齐原平台挂载。
  for (const row of clientRows) {
    if (isClientMatchPmEnded(row)) endedAtByClientId.set(Number(row.id ?? row.ID), Date.now());
  }
  const endedPmSportByPolymarketLink = fromVenuesOnly
    ? new Map()
    : buildEndedPmSportByPolymarketLink(clientRows);

  const ended = filterActiveClientMatches(info || [], {
    platformMatches: matches,
    timersByProvider: timers,
    pmSportByClientId,
    endedAtByClientId,
    endedPmSportByPolymarketLink,
  });

  return {
    info: ended.list,
    endedRows: ended.endedList || [],
    endedCount: ended.endedCount,
  };
}

/** 写库前：仅对 End 后仍存活的行 insert stub */
export async function resolveMatchIdsForWrite(info, snapshot, opts = {}) {
  const fromVenuesOnly = !!opts.fromVenuesOnly || !!snapshot._fromVenuesOnly;
  const { adapter = null, existingIdKeyIndex = null } = opts;
  if (!adapter || !(info || []).length)
    return info || [];
  if (fromVenuesOnly)
    throw new Error("[match-composer] fromVenuesOnly 禁止写库");

  const matches = snapshot.matches || {};
  const alignClientRows = fromVenuesOnly ? [] : (snapshot.alignClientRows || []);
  const clientRows = fromVenuesOnly ? [] : (snapshot.clientRows || []);
  const alignRows = alignClientRows?.length ? alignClientRows : clientRows;
  const index = existingIdKeyIndex || (fromVenuesOnly
    ? new Map()
    : buildExistingClientIdKeyIndex(alignRows, matches));

  return resolveIdsForWrite(adapter, stripTempIds(info), {
    matches,
    existingIdKeyIndex: index,
  });
}

/**
 * 兼容旧调用：Match → End →（可选）insert stub。
 * 新代码请直接用 runMatchPass / runEndPass。
 */
export async function resolveAndProject(list, snapshot, opts = {}) {
  const {
    allowInsert = false,
    adapter = null,
  } = opts;

  const match = runMatchPass(list, snapshot, opts);
  const end = runEndPass(match.info, snapshot, opts);

  let info = end.info;
  if (allowInsert && adapter && info.length) {
    info = await resolveMatchIdsForWrite(info, snapshot, {
      ...opts,
      adapter,
      existingIdKeyIndex: match.existingIdKeyIndex,
    });
  }

  return {
    info,
    endedRows: end.endedRows,
    projectStats: match.projectStats,
    endedCount: end.endedCount,
    mergedDuplicateIds: match.mergedDuplicateIds,
    preEndedCount: match.preEndedCount,
    processedActiveIds: match.processedActiveIds,
    fromVenuesOnly: match.fromVenuesOnly,
  };
}
