import * as db from "@changmen/db";
import { normalizeEpochMs } from "@changmen/shared/time/match_time";
import {
  isComposerForceReanchor,
  isComposerStickyOrientation,
  isComposerWriteEnabled,
} from "../lib/config.js";
import "../lib/env_composer.js";
import { writeComposerHeartbeat } from "../lib/heartbeat.js";
import { assertComposerMayWrite, withMatcherWriteLock } from "../lib/write_guard.js";
import { loadSnapshot } from "./io/snapshot.js";
import { snapshotFromVenuesOnly } from "./io/venues_only.js";
import { writeClientMatches } from "./io/write.js";
import { refreshExistingMatches } from "./refresh_matches.js";
import {
  composeFromSnapshot,
  resolveMatchIdsForWrite,
  runEndPass,
  runMatchPass,
} from "./pipeline.js";
import {
  ALL_SOURCES_GONE_MS,
  allPlatformSourcesGone,
  isClientMatchPmEnded,
} from "./shape/ended_filter.js";

/**
 * M1：匹配缺口 ≠ 结束。
 * PM 已确认结束，或 gap 的全部馆源消失且超过 ALL_SOURCES_GONE 时间门，
 * 才进 markEndedIds（只写 ended_at）。
 * 馆源仍在、本拍只是没合出来 → 仍只记 activeGaps，不结束。
 */
export function resolveComposeEndPatch({
  previousActiveIds = [],
  info = [],
  endedRows = [],
  clientRows = [],
  platformMatches = null,
  now = Date.now(),
} = {}) {
  const activeIds = new Set(
    (info || []).map(m => Number(m.ID)).filter(id => Number.isFinite(id) && id > 0),
  );
  const endedIds = new Set(
    (endedRows || []).map(m => Number(m.ID)).filter(id => Number.isFinite(id) && id > 0),
  );
  const gaps = (previousActiveIds || [])
    .map(Number)
    .filter(id => Number.isFinite(id) && id > 0 && !activeIds.has(id) && !endedIds.has(id));

  const byId = new Map();
  for (const row of clientRows || []) {
    const id = Number(row?.id ?? row?.ID);
    if (Number.isFinite(id) && id > 0)
      byId.set(id, row);
  }

  const markEndedIds = [];
  const activeGaps = [];
  for (const id of gaps) {
    const row = byId.get(id);
    if (!row) {
      activeGaps.push(id);
      continue;
    }
    const matchs = row.matchs ?? row.Matchs ?? {};
    const startMs = normalizeEpochMs(row.start_time ?? row.StartTime);
    if (
      isClientMatchPmEnded(row, row.pm_sport ?? row.PmSport, now)
      || (platformMatches != null && startMs > 0
      && startMs <= now - ALL_SOURCES_GONE_MS
      && allPlatformSourcesGone(matchs, platformMatches))
    ) {
      markEndedIds.push(id);
    }
    else {
      activeGaps.push(id);
    }
  }
  return { markEndedIds, activeGaps };
}

/**
 * 空写策略（防误清活跃集）：
 * - info 非空 → 放行
 * - ALLOW_EMPTY_WRITE=1 → 强制放行
 * - endedCount>0 且本拍处理过的正 ID + sources-gone markEndedIds 覆盖 RDS 全部 active → 允许
 * - info 空、endedCount=0，但 markEndedIds 已覆盖全部 previous active（全是僵尸收尾）→ 允许
 * - 其余 → 拒写
 * - 明确指定结束 ID 时允许仅更新状态，其它未处理活跃场保持原样。
 */
export function shouldAllowEmptyWrite({
  info,
  endedCount,
  allowEmptyWrite,
  processedActiveIds,
  previousActiveIds,
  markEndedIds = [],
  endedRowIds = [],
} = {}) {
  if (info?.length)
    return { ok: true, reason: "nonempty" };
  if (allowEmptyWrite)
    return { ok: true, reason: "forced" };

  const ended = Number(endedCount) || 0;
  const prev = [...(previousActiveIds || [])].filter(id => Number.isFinite(id) && id > 0);
  const processed = processedActiveIds instanceof Set
    ? processedActiveIds
    : new Set(processedActiveIds || []);
  const marked = new Set(
    (markEndedIds || []).map(Number).filter(id => Number.isFinite(id) && id > 0),
  );

  if (!prev.length) {
    // RDS 本就无 active：空写无害
    return { ok: true, reason: "all_ended_no_previous" };
  }

  const uncovered = prev.filter(id => !processed.has(id) && !marked.has(id));
  if (uncovered.length) {
    // 明确的状态更新只触及指定 ID，其它未合出的活跃记录保持原样。
    const explicit = new Set([...marked, ...endedRowIds].map(Number));
    if (prev.some(id => explicit.has(id))) return { ok: true, reason: "lifecycle_only" };
    return {
      ok: false,
      reason: ended <= 0 && !marked.size
        ? "empty_without_ended"
        : "empty_but_unprocessed_actives",
      uncoveredCount: uncovered.length,
    };
  }

  if (ended <= 0 && !marked.size)
    return { ok: false, reason: "empty_without_ended" };

  if (ended <= 0 && marked.size)
    return { ok: true, reason: "all_sources_gone_covered" };

  return { ok: true, reason: "all_ended_covered" };
}

/**
 * 一次合场（M2：Match → End，分日志；写库仍一次）。
 * 默认不写库（MATCH_COMPOSER_WRITE=1 才写）。
 * @param {boolean} [opts.fromVenuesOnly] 忽略 RDS client_matches / 绑定 / sticky，纯场馆合场（检验用；禁止写库）
 */
async function composeOnceUnlocked({
  write = isComposerWriteEnabled(),
  registerTeams = true,
  forceReanchorOrientation = isComposerForceReanchor(),
  stickyOrientation = isComposerStickyOrientation() ? true : undefined,
  viaMatcherWriter = false,
  allowEmptyWrite = String(process.env.MATCH_COMPOSER_ALLOW_EMPTY_WRITE || "").trim() === "1",
  fromVenuesOnly = false,
} = {}) {
  if (fromVenuesOnly && write) {
    throw new Error("[match-composer] fromVenuesOnly 仅用于检验，禁止写库");
  }

  let snapshot = await loadSnapshot({ registerTeams });
  if (fromVenuesOnly)
    snapshot = snapshotFromVenuesOnly(snapshot);

  const t0 = Date.now();
  const { list, alignStats, skippedBindings } = composeFromSnapshot(snapshot, {
    fromVenuesOnly,
  });
  const clusterMs = Date.now() - t0;

  const passOpts = {
    forceReanchorOrientation,
    stickyOrientation,
    fromVenuesOnly,
  };

  const tMatch = Date.now();
  const match = runMatchPass(list, snapshot, passOpts);
  // 先刷新全部未结束的 changmen 比赛并保留完整映射，再统一执行原有结束规则。
  const matchesForEnd = refreshExistingMatches(match.info, snapshot, passOpts);
  const matchMs = Date.now() - tMatch;

  const tEnd = Date.now();
  const end = runEndPass(matchesForEnd, snapshot, passOpts);
  const endMs = Date.now() - tEnd;

  let info = end.info;
  const endedRows = end.endedRows;
  const composedEndedCount = end.endedCount;

  const adapter = write && db.isMatcherStoreReady()
    ? db.getClientMatchIdAdapter()
    : null;

  if (write && adapter && info.length) {
    info = await resolveMatchIdsForWrite(info, snapshot, {
      ...passOpts,
      adapter,
      existingIdKeyIndex: match.existingIdKeyIndex,
    });
  }

  const previousActiveIds = fromVenuesOnly
    ? []
    : (snapshot.clientRows || [])
      .filter(r => r.ended_at == null && r.endedAt == null)
      .map(r => Number(r.id ?? r.ID))
      .filter(id => Number.isFinite(id) && id > 0);

  // 试算和写入使用同一份结束计划，包含本轮未合出的已有比赛。
  const { markEndedIds, activeGaps } = resolveComposeEndPatch({
    previousActiveIds,
    info,
    endedRows,
    clientRows: snapshot.clientRows,
    platformMatches: snapshot.matches,
  });
  const endedCount = composedEndedCount + markEndedIds.length;

  console.log(
    `[match-composer] matchPass ${matchMs}ms rows=${matchesForEnd.length}`
    + ` · endPass ${endMs}ms ended=${endedCount} live=${info.length}`
    + ` · cluster ${clusterMs}ms`,
  );

  const now = Date.now();
  let wrote = false;
  let matchIdBackfill = null;
  if (write) {
    const guard = assertComposerMayWrite({
      skipMatcherHeartbeat: viaMatcherWriter === true,
    });
    if (!guard.ok)
      throw new Error(`[match-composer] ${guard.reason}`);

    if (markEndedIds.length) {
      console.log(
        `[match-composer] lifecycle end: ${markEndedIds.slice(0, 20).join(",")}`
        + (markEndedIds.length > 20 ? `…(+${markEndedIds.length - 20})` : ""),
      );
    }
    if (activeGaps.length) {
      console.warn(
        `[match-composer] active gap (not ending): ${activeGaps.slice(0, 20).join(",")}`
        + (activeGaps.length > 20 ? `…(+${activeGaps.length - 20})` : ""),
      );
    }

    const emptyOk = shouldAllowEmptyWrite({
      info,
      endedCount,
      allowEmptyWrite,
      processedActiveIds: new Set(matchesForEnd.map(row => Number(row.ID)).filter(id => id > 0)),
      previousActiveIds,
      markEndedIds,
      endedRowIds: endedRows.map(row => Number(row.ID)),
    });
    if (!emptyOk.ok) {
      throw new Error(
        `[match-composer] 拒绝空写（${emptyOk.reason}`
        + `${emptyOk.uncoveredCount ? ` uncovered=${emptyOk.uncoveredCount}` : ""}）。`
        + " 防未处理活跃场被整表归档；应急可设 MATCH_COMPOSER_ALLOW_EMPTY_WRITE=1",
      );
    }

    const stickyEndedIds = (snapshot.clientRows || [])
      .filter(r => r.ended_at != null || r.endedAt != null)
      .map(r => Number(r.id ?? r.ID))
      .filter(id => Number.isFinite(id) && id > 0);

    await writeClientMatches(info, now, { endedRows, markEndedIds, stickyEndedIds, existingClientRows: snapshot.clientRows });
    wrote = true;
    writeComposerHeartbeat({
      matchCount: info.length,
      builtAt: now,
      wrote: true,
    });

    try {
      const { backfillPlatformMatchIdsForIdMerges } = await import(
        "../ops/backfill_platform_match_ids.js"
      );
      matchIdBackfill = await backfillPlatformMatchIdsForIdMerges(info, snapshot.matches);
      if (matchIdBackfill?.updated) {
        try {
          const { invalidateMatcherRdsSnapshot } = await import(
            "../ops/rds_snapshot_cache.js"
          );
          invalidateMatcherRdsSnapshot(["platformMatches", "clientMatches"]);
        }
        catch { /* 独立进程无 cache */ }
      }
    }
    catch (err) {
      console.error("[match-composer] backfillPlatformMatchIds FAILED:", err.message);
    }
  }

  return {
    matchCount: info.length,
    builtAt: now,
    wrote,
    projectStats: match.projectStats,
    alignStats,
    skippedBindings,
    endedCount,
    markEndedIds,
    activeGaps,
    mergedDuplicateIds: match.mergedDuplicateIds,
    matchIdBackfill,
    teamReg: snapshot.teamReg,
    nameSync: snapshot.nameSync,
    previousActiveIds,
    fromVenuesOnly: !!fromVenuesOnly,
    matches: snapshot.matches,
    info,
    timing: { clusterMs, matchMs, endMs },
  };
}

export function composeOnce(options = {}) {
  const write = options.write === undefined ? isComposerWriteEnabled() : options.write;
  return write
    ? withMatcherWriteLock(() => composeOnceUnlocked(options))
    : composeOnceUnlocked(options);
}
