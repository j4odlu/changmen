/**
 * 采集路径 — platform_matches / platform_bets / live_timers（SaveMatch/SaveBet/SaveLiveTimer）。
 */

import { _writeRds, _writeRdsAsync, getPgPool } from "./common.js";

/**
 * SaveMatch 为全量快照；单轮残缺/空列表会把 platform_matches 整批 orphan 进 history，
 * MATCHER 上表现为盘口一会有一会没有（PB 先修；OB/RAY 同症）。
 * sticky 馆：空快照不清空；缺席场次仅在 synced_at 超过宽限后才 orphan。
 */
export const PB_SNAPSHOT_ORPHAN_GRACE_MS = 5 * 60 * 1000;

/** @type {ReadonlySet<string>} */
const STICKY_PLATFORM_MATCH_SNAPSHOTS = new Set(["PB", "OB", "RAY"]);

/**
 * RDS `_writeRds` 同 key 会 coalesce。采集一轮 = 1 次 matches + N 次 bets，
 * 若共用 `collector:${plat}`，多场 SaveBet 会互相覆盖，只留下最后一场盘口。
 * matches / timers / 每场 bets 必须拆 key。
 */
export function collectorMatchesWriteKey(platform) {
  return `collector:${String(platform || "").trim()}:matches`;
}

export function collectorBetsWriteKey(platform, matchId) {
  return `collector:${String(platform || "").trim()}:bets:${String(matchId ?? "")}`;
}

export function collectorTimersWriteKey(platform) {
  return `collector:${String(platform || "").trim()}:timers`;
}

export function isStickyPlatformMatchSnapshot(platform) {
  return STICKY_PLATFORM_MATCH_SNAPSHOTS.has(String(platform || "").trim());
}

export function shouldIgnoreEmptyPlatformMatchSnapshot(platform) {
  const plat = String(platform || "").trim();
  // Polymarket：VPS 独占，清理走 prune；PB/OB/RAY：防误清
  return plat === "Polymarket" || isStickyPlatformMatchSnapshot(plat);
}

/** @returns {number|null} null = 立即删本批之外；number = 仅删 synced_at 早于该时刻的缺席行 */
export function platformMatchOrphanCutoffMs(platform, now = Date.now()) {
  if (!isStickyPlatformMatchSnapshot(platform))
    return null;
  return Number(now) - PB_SNAPSHOT_ORPHAN_GRACE_MS;
}

/** 解析 orphanBeforeMs：null/undefined/"" → 立即删；勿把 Number(null)=0 当成 cutoff */
export function resolveSnapshotOrphanBeforeMs(orphanBeforeMs) {
  if (orphanBeforeMs == null || orphanBeforeMs === "")
    return null;
  const n = Number(orphanBeforeMs);
  return Number.isFinite(n) ? n : null;
}

function _mapLiveTimerRows(provider, timer) {
  if (!Array.isArray(timer))
    return null;
  const plat = String(provider);
  const now = Date.now();
  const seen = new Map();
  for (const t of timer) {
    if (!t || t.MatchID == null)
      continue;
    const source_match_id = String(t.MatchID);
    seen.set(source_match_id, {
      platform: plat,
      source_match_id,
      round: Number(t.Round) || 0,
      round_start: Number(t.StartTime) || 0,
      updated_at: now,
    });
  }
  return { plat, rows: [...seen.values()] };
}

/** 删除该平台本批快照之外的 platform_matches / live_timers（不含 platform_bets）。
 * platform_bets 由 replacePlatformBets* 按场覆盖；孤儿盘口在 collector cycle 末尾单独清，
 * 避免 matches upsert 事务里先删 bets 造成「地图盘闪没」。
 * @param {{ wipeBets?: boolean, orphanBeforeMs?: number|null }} [opts]
 *   orphanBeforeMs：仅删 synced_at < 该时刻（或 null synced）的缺席行；缺省立即删。
 */
async function _rdsDeletePlatformSnapshotOrphans(exec, platform, keepSourceMatchIds, {
  wipeBets = false,
  orphanBeforeMs = null,
} = {}) {
  const plat = String(platform);
  const ids = (keepSourceMatchIds || []).map(String);
  const stickyCutoff = resolveSnapshotOrphanBeforeMs(orphanBeforeMs);
  const staleMatchClause = stickyCutoff != null
    ? "AND (synced_at IS NULL OR synced_at < $CUTOFF::bigint)"
    : "";
  const staleTimerClause = stickyCutoff != null
    ? "AND (updated_at IS NULL OR updated_at < $CUTOFF::bigint)"
    : "";

  if (!ids.length) {
    // 粘滞馆：空 keep 不得整馆清空（由上层 ignore []）；非粘滞仍可全清
    if (stickyCutoff != null)
      return;
    if (wipeBets) {
      await exec.query(
        `DELETE FROM platform_bets WHERE platform = $1`,
        [plat],
      );
    }
    await exec.query(
      `DELETE FROM live_timers WHERE platform = $1`,
      [plat],
    );
    await exec.query(
      `WITH moved AS (
         DELETE FROM platform_matches WHERE platform = $1
         RETURNING *
       )
       INSERT INTO platform_matches_history (platform, source_match_id, source_game_id, start_time, home_id, home, away_id, away, bo, is_live, rot_num, teams, synced_at, match_id)
       SELECT platform, source_match_id, source_game_id, start_time, home_id, home, away_id, away, bo, is_live, rot_num, teams, synced_at, match_id FROM moved`,
      [plat],
    );
    return;
  }

  const betParams = stickyCutoff != null ? [plat, ids, stickyCutoff] : [plat, ids];
  const matchSqlCutoff = stickyCutoff != null
    ? staleMatchClause.replaceAll("$CUTOFF", "$3")
    : "";
  const timerSqlCutoff = stickyCutoff != null
    ? staleTimerClause.replaceAll("$CUTOFF", "$3")
    : "";

  if (wipeBets) {
    await exec.query(
      `DELETE FROM platform_bets
       WHERE platform = $1 AND NOT (source_match_id = ANY($2::text[]))`,
      [plat, ids],
    );
  }
  await exec.query(
    `DELETE FROM live_timers
     WHERE platform = $1 AND NOT (source_match_id = ANY($2::text[]))
     ${timerSqlCutoff}`,
    betParams,
  );
  await exec.query(
    `WITH moved AS (
       DELETE FROM platform_matches
       WHERE platform = $1 AND NOT (source_match_id = ANY($2::text[]))
       ${matchSqlCutoff}
       RETURNING *
     )
     INSERT INTO platform_matches_history (platform, source_match_id, source_game_id, start_time, home_id, home, away_id, away, bo, is_live, rot_num, teams, synced_at, match_id)
     SELECT platform, source_match_id, source_game_id, start_time, home_id, home, away_id, away, bo, is_live, rot_num, teams, synced_at, match_id FROM moved`,
    betParams,
  );
}

async function _rdsClearPlatformMatchSnapshot(pool, platform) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await _rdsDeletePlatformSnapshotOrphans(client, platform, [], { wipeBets: true });
    await client.query("COMMIT");
  }
  catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
  finally {
    client.release();
  }
}

async function _rdsUpsertPlatformMatches(pool, rows, opts = {}) {
  if (!rows.length)
    return;
  const client = await pool.connect();
  const platform = String(rows[0].platform);
  const alsoKeep = Array.isArray(opts.alsoKeepSourceMatchIds)
    ? opts.alsoKeepSourceMatchIds.map(String).filter(Boolean)
    : [];
  const keepIds = [...new Set([
    ...rows.map(r => String(r.source_match_id)),
    ...alsoKeep,
  ])];
  // Polymarket：VPS 独占，只 upsert；清理走 prunePolymarketPlatformMatches（ended ∪ synced 过旧）
  const allowOrphanDelete = platform !== "Polymarket";
  const orphanBeforeMs = platformMatchOrphanCutoffMs(platform, Date.now());
  const sql = `
    INSERT INTO platform_matches (
      platform, source_match_id, source_game_id, start_time,
      home_id, home, away_id, away, bo, is_live, rot_num, teams, synced_at
    )
    SELECT * FROM unnest(
      $1::text[], $2::text[], $3::text[], $4::bigint[],
      $5::text[], $6::text[], $7::text[], $8::text[],
      $9::smallint[], $10::smallint[], $11::text[], $12::jsonb[], $13::bigint[]
    )
    ON CONFLICT (platform, source_match_id) DO UPDATE SET
      source_game_id = EXCLUDED.source_game_id,
      start_time = EXCLUDED.start_time,
      home_id = EXCLUDED.home_id,
      home = EXCLUDED.home,
      away_id = EXCLUDED.away_id,
      away = EXCLUDED.away,
      bo = EXCLUDED.bo,
      -- 旧采集未带 IsLive 时勿清空（EXCLUDED 为 NULL）
      is_live = COALESCE(EXCLUDED.is_live, platform_matches.is_live),
      -- 旧采集未带 RotNum 时勿清空已写入的归组键
      rot_num = COALESCE(EXCLUDED.rot_num, platform_matches.rot_num),
      teams = EXCLUDED.teams,
      synced_at = EXCLUDED.synced_at
  `;
  try {
    await client.query("BEGIN");
    await client.query(sql, [
      rows.map(r => r.platform),
      rows.map(r => r.source_match_id),
      rows.map(r => r.source_game_id),
      rows.map(r => r.start_time),
      rows.map(r => r.home_id),
      rows.map(r => r.home),
      rows.map(r => r.away_id),
      rows.map(r => r.away),
      rows.map(r => r.bo),
      rows.map(r => r.is_live),
      rows.map(r => r.rot_num),
      rows.map(r => JSON.stringify(Array.isArray(r.teams) ? r.teams : [])),
      rows.map(r => r.synced_at),
    ]);
    if (allowOrphanDelete) {
      await _rdsDeletePlatformSnapshotOrphans(client, platform, keepIds, {
        orphanBeforeMs,
      });
    }
    await client.query("COMMIT");
  }
  catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
  finally {
    client.release();
  }
}

/**
 * Polymarket 显式清理：只删已 ended/closed（forceDeleteIds），或 synced_at 过旧（防堆积）。
 * 采集窗只约束 Gamma 拉取体积，不得按 start_time 窗外删行（否则与 live 补 pass 矛盾）。
 * @param {{
 *   forceDeleteIds?: string[],
 *   staleBeforeMs?: number,
 * }} [opts]
 * @returns {Promise<string[]>} 删除的 source_match_id
 */
async function _rdsPrunePolymarketPlatformMatches(pool, opts = {}) {
  const forceDelete = Array.isArray(opts.forceDeleteIds)
    ? [...new Set(opts.forceDeleteIds.map(String).filter(Boolean))]
    : [];
  const now = Date.now();
  // 48h 无 upsert：Gamma 既不返回 ended 也不再出现在窗/live 时兜底下线
  const staleBefore = Number.isFinite(Number(opts.staleBeforeMs))
    ? Number(opts.staleBeforeMs)
    : now - 48 * 3600 * 1000;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const moved = await client.query(
      `WITH moved AS (
         DELETE FROM platform_matches
         WHERE platform = 'Polymarket'
           AND (
             source_match_id = ANY($1::text[])
             OR (synced_at IS NOT NULL AND synced_at < $2::bigint)
           )
         RETURNING *
       )
       INSERT INTO platform_matches_history (
         platform, source_match_id, source_game_id, start_time, home_id, home,
         away_id, away, bo, is_live, rot_num, teams, synced_at, match_id
       )
       SELECT platform, source_match_id, source_game_id, start_time, home_id, home,
              away_id, away, bo, is_live, rot_num, teams, synced_at, match_id
       FROM moved
       RETURNING source_match_id`,
      [forceDelete, staleBefore],
    );
    const deletedIds = moved.rows.map(r => String(r.source_match_id));
    if (deletedIds.length) {
      await client.query(
        `DELETE FROM platform_bets
         WHERE platform = 'Polymarket' AND source_match_id = ANY($1::text[])`,
        [deletedIds],
      );
      await client.query(
        `DELETE FROM live_timers
         WHERE platform = 'Polymarket' AND source_match_id = ANY($1::text[])`,
        [deletedIds],
      );
    }
    await client.query("COMMIT");
    return deletedIds;
  }
  catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
  finally {
    client.release();
  }
}

async function _rdsUpsertPlatformBets(exec, rows) {
  if (!rows.length)
    return;
  const sql = `
    INSERT INTO platform_bets (
      platform, source_match_id, source_bet_id, map, bet_name,
      home_odds, away_odds, is_locked, source_home_id, source_away_id, market_id, line_id, updated_at
    )
    SELECT * FROM unnest(
      $1::text[], $2::text[], $3::text[], $4::smallint[], $5::text[],
      $6::numeric[], $7::numeric[], $8::boolean[], $9::text[], $10::text[], $11::text[], $12::bigint[], $13::bigint[]
    )
    ON CONFLICT (platform, source_match_id, source_bet_id) DO UPDATE SET
      map = EXCLUDED.map,
      bet_name = EXCLUDED.bet_name,
      home_odds = EXCLUDED.home_odds,
      away_odds = EXCLUDED.away_odds,
      is_locked = EXCLUDED.is_locked,
      source_home_id = EXCLUDED.source_home_id,
      source_away_id = EXCLUDED.source_away_id,
      market_id = EXCLUDED.market_id,
      line_id = EXCLUDED.line_id,
      updated_at = EXCLUDED.updated_at
  `;
  await exec.query(sql, [
    rows.map(r => r.platform),
    rows.map(r => r.source_match_id),
    rows.map(r => r.source_bet_id),
    rows.map(r => r.map),
    rows.map(r => r.bet_name),
    rows.map(r => r.home_odds),
    rows.map(r => r.away_odds),
    rows.map(r => r.is_locked),
    rows.map(r => r.source_home_id),
    rows.map(r => r.source_away_id),
    rows.map(r => r.market_id),
    rows.map(r => r.line_id),
    rows.map(r => r.updated_at),
  ]);
}

async function _rdsReplacePlatformBets(pool, platform, matchId, rows) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "DELETE FROM platform_bets WHERE platform = $1 AND source_match_id = $2",
      [String(platform), String(matchId)],
    );
    await _rdsUpsertPlatformBets(client, rows);
    await client.query("COMMIT");
  }
  catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
  finally {
    client.release();
  }
}

/**
 * 按 source_bet_id upsert，再删「本场不在本批里的」旧行。
 * 与 replace（先清空整场）不同：map0 行不会先抹掉 map1/map2；
 * 仅当本批完整快照里确实没有某 bet_id 时才删该行。
 */
async function _rdsSyncPlatformBetsForMatch(pool, platform, matchId, rows) {
  const plat = String(platform);
  const mid = String(matchId);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (rows.length)
      await _rdsUpsertPlatformBets(client, rows);
    const keepBetIds = rows.map(r => String(r.source_bet_id));
    if (!keepBetIds.length) {
      await client.query(
        `DELETE FROM platform_bets WHERE platform = $1 AND source_match_id = $2`,
        [plat, mid],
      );
    }
    else {
      await client.query(
        `DELETE FROM platform_bets
         WHERE platform = $1 AND source_match_id = $2
           AND NOT (source_bet_id = ANY($3::text[]))`,
        [plat, mid, keepBetIds],
      );
    }
    await client.query("COMMIT");
  }
  catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
  finally {
    client.release();
  }
}

/** 全量替换某平台 timer 快照：先删该平台全部行，再 upsert 本批（空批 = 清空该平台） */
async function _rdsReplaceLiveTimersForPlatform(pool, platform, rows) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM live_timers WHERE platform = $1", [String(platform)]);
    if (rows.length) {
      await client.query(
        `INSERT INTO live_timers (platform, source_match_id, round, round_start, updated_at)
         SELECT * FROM unnest($1::text[], $2::text[], $3::smallint[], $4::bigint[], $5::bigint[])
         ON CONFLICT (platform, source_match_id) DO UPDATE SET
           round = EXCLUDED.round,
           round_start = EXCLUDED.round_start,
           updated_at = EXCLUDED.updated_at`,
        [
          rows.map(r => r.platform),
          rows.map(r => r.source_match_id),
          rows.map(r => r.round),
          rows.map(r => r.round_start),
          rows.map(r => r.updated_at),
        ],
      );
    }
    await client.query("COMMIT");
  }
  catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
  finally {
    client.release();
  }
}

async function _rdsFetchPlatformMatches(pool) {
  const { rows } = await pool.query(
    `SELECT platform, source_match_id, source_game_id, start_time, home, home_id, away, away_id, bo, is_live, rot_num, teams, match_id
     FROM platform_matches`,
  );
  const byPlatform = {};
  for (const r of rows) {
    if (!byPlatform[r.platform])
      byPlatform[r.platform] = [];
    const rot = r.rot_num != null ? String(r.rot_num).trim() : "";
    byPlatform[r.platform].push({
      Type: r.platform,
      SourceMatchID: r.source_match_id,
      SourceGameID: r.source_game_id ?? "",
      StartTime: r.start_time ?? 0,
      Home: r.home ?? "",
      HomeID: r.home_id ?? "",
      Away: r.away ?? "",
      AwayID: r.away_id ?? "",
      BO: r.bo ?? 0,
      IsLive: r.is_live != null ? Number(r.is_live) : undefined,
      ...(rot ? { RotNum: rot } : {}),
      Teams: Array.isArray(r.teams) ? r.teams : [],
      ClientMatchId: r.match_id != null ? Number(r.match_id) : null,
    });
  }
  return byPlatform;
}

async function _rdsFetchPlatformBets(pool) {
  const { rows } = await pool.query(
    `SELECT platform, source_bet_id, source_match_id, map, bet_name,
            source_home_id, source_away_id, home_odds, away_odds, is_locked, market_id, line_id
     FROM platform_bets`,
  );
  const byKey = {};
  for (const r of rows) {
    const key = `${r.platform}:${r.source_match_id}`;
    if (!byKey[key])
      byKey[key] = { provider: r.platform, matchId: r.source_match_id, bets: [], savedAt: 0 };
    const bet = {
      SourceBetID: r.source_bet_id,
      BetName: r.bet_name ?? "",
      Map: r.map ?? 0,
      SourceHomeID: r.source_home_id ?? "",
      SourceAwayID: r.source_away_id ?? "",
      HomeOdds: r.home_odds ?? 0,
      AwayOdds: r.away_odds ?? 0,
      Status: r.is_locked ? "Locked" : "Normal",
    };
    const mid = String(r.market_id ?? "").trim();
    if (mid)
      bet.MarketID = mid;
    const lineId = Number(r.line_id) || 0;
    if (lineId > 0)
      bet.LineID = lineId;
    byKey[key].bets.push(bet);
  }
  return byKey;
}

async function _rdsFetchLiveTimers(pool) {
  const { rows } = await pool.query(
    "SELECT platform, source_match_id, round, round_start FROM live_timers",
  );
  const byPlatform = {};
  for (const r of rows) {
    if (!byPlatform[r.platform])
      byPlatform[r.platform] = { provider: r.platform, timer: [], savedAt: 0 };
    byPlatform[r.platform].timer.push({
      MatchID: r.source_match_id,
      Round: r.round ?? 0,
      StartTime: r.round_start ?? 0,
    });
  }
  return byPlatform;
}

async function _rdsFetchPlatformCollectorMeta(pool) {
  const { rows } = await pool.query(
    `SELECT 'platformMatches' AS key,
            COUNT(*)::int AS count,
            COALESCE(MAX(synced_at), 0)::bigint AS marker,
            COUNT(match_id)::int AS linked_count,
            COALESCE(MAX(match_id), 0)::bigint AS linked_marker
     FROM platform_matches
     UNION ALL
     SELECT 'platformBets' AS key,
            COUNT(*)::int AS count,
            COALESCE(MAX(updated_at), 0)::bigint AS marker,
            0::int AS linked_count,
            0::bigint AS linked_marker
     FROM platform_bets
     UNION ALL
     SELECT 'liveTimers' AS key,
            COUNT(*)::int AS count,
            COALESCE(MAX(updated_at), 0)::bigint AS marker,
            0::int AS linked_count,
            0::bigint AS linked_marker
     FROM live_timers`,
  );
  const meta = {};
  for (const r of rows) {
    meta[r.key] = {
      count: Number(r.count) || 0,
      marker: Number(r.marker) || 0,
      linkedCount: Number(r.linked_count) || 0,
      linkedMarker: Number(r.linked_marker) || 0,
    };
  }
  return meta;
}

async function _rdsSetPlatformMatchId(pool, platform, sourceMatchId, matchId, onlyIfNull) {
  const sql = onlyIfNull
    ? `UPDATE platform_matches SET match_id = $3
       WHERE platform = $1 AND source_match_id = $2 AND match_id IS NULL`
    : `UPDATE platform_matches SET match_id = $3
       WHERE platform = $1 AND source_match_id = $2`;
  const res = await pool.query(sql, [String(platform), String(sourceMatchId), Number(matchId)]);
  return res.rowCount ?? 0;
}

/**
 * 回写 platform_matches.match_id（RDS）。
 * @returns {Promise<{ updated: boolean, skipped: boolean, conflict: boolean }>}
 */
export async function setPlatformMatchId(platform, sourceMatchId, matchId, opts = {}) {
  const onlyIfNull = opts.onlyIfNull !== false && opts.force !== true;
  const plat = String(platform);
  const srcId = String(sourceMatchId);
  const cmId = Number(matchId);
  if (!Number.isFinite(cmId))
    return { updated: false, skipped: true, conflict: false };

  const pool = getPgPool();
  if (!pool)
    return { updated: false, skipped: true, conflict: false };

  const { rows } = await pool.query(
    "SELECT match_id FROM platform_matches WHERE platform = $1 AND source_match_id = $2",
    [plat, srcId],
  );
  if (!rows.length)
    return { updated: false, skipped: true, conflict: false };

  const cur
    = rows[0].match_id != null && rows[0].match_id !== "" ? Number(rows[0].match_id) : null;
  if (cur === cmId)
    return { updated: false, skipped: true, conflict: false };
  if (cur != null && cur !== cmId && onlyIfNull)
    return { updated: false, skipped: false, conflict: true };

  const n = await _rdsSetPlatformMatchId(pool, plat, srcId, cmId, onlyIfNull);
  return { updated: n > 0, skipped: n === 0, conflict: false };
}

/**
 * M4：清空所有仍指向已 ended client_matches 的 platform_matches.match_id。
 * 用 JOIN 自愈，避免每拍传入全表 sticky id 列表。
 * @returns {Promise<{ cleared: number }>}
 */
export async function clearPlatformMatchIdsForClientMatchIds(clientMatchIds) {
  const ids = [...new Set(
    (clientMatchIds || [])
      .map(Number)
      .filter(id => Number.isFinite(id) && id > 0),
  )];
  if (!ids.length)
    return { cleared: 0 };

  const pool = getPgPool();
  if (!pool)
    return { cleared: 0 };

  const res = await pool.query(
    `UPDATE platform_matches
     SET match_id = NULL
     WHERE match_id = ANY($1::bigint[])`,
    [ids],
  );
  return { cleared: res.rowCount ?? 0 };
}

/**
 * M4：清空仍挂在已结束 client_matches 上的 match_id（不传 id 列表）。
 * @returns {Promise<{ cleared: number }>}
 */
export async function clearPlatformMatchIdsPointingAtEnded() {
  const pool = getPgPool();
  if (!pool)
    return { cleared: 0 };

  const res = await pool.query(
    `UPDATE platform_matches pm
     SET match_id = NULL
     FROM client_matches cm
     WHERE pm.match_id = cm.id
       AND cm.ended_at IS NOT NULL`,
  );
  return { cleared: res.rowCount ?? 0 };
}

function mapPlatformMatchRows(provider, matchs) {
  const now = Date.now();
  return matchs.map(m => {
    const rotRaw = m.RotNum ?? m.rot_num ?? m.rotNum;
    const rot = rotRaw != null ? String(rotRaw).trim() : "";
    return {
      platform: String(provider),
      source_match_id: String(m.SourceMatchID),
      source_game_id: m.SourceGameID != null ? String(m.SourceGameID) : null,
      start_time: Number(m.StartTime) || null,
      home_id: m.HomeID != null ? String(m.HomeID) : null,
      home: String(m.Home || ""),
      away_id: m.AwayID != null ? String(m.AwayID) : null,
      away: String(m.Away || ""),
      bo: m.BO != null ? Number(m.BO) : null,
      is_live: m.IsLive != null ? Number(m.IsLive) : null,
      rot_num: rot || null,
      teams: Array.isArray(m.Teams) ? m.Teams : [],
      synced_at: now,
    };
  });
}

/** fire-and-forget：按平台 upsert 本批比赛。
 * 非 Polymarket：并删除本批之外的孤儿行；[] = 空快照全清。
 * Polymarket：只 upsert（VPS 独占）；[] 忽略；清理用 prunePolymarketPlatformMatches。
 * sticky（PB/OB/RAY）：[] 忽略；缺席行仅在 synced_at 超过 PB_SNAPSHOT_ORPHAN_GRACE_MS 后 orphan。
 * @param {string} provider
 * @param {object[]} matchs
 * @param {{ alsoKeepSourceMatchIds?: string[] }} [opts]
 */
export function writePlatformMatches(provider, matchs, opts = {}) {
  if (!Array.isArray(matchs))
    return;
  const plat = String(provider);
  if (!matchs.length) {
    if (shouldIgnoreEmptyPlatformMatchSnapshot(plat)) {
      console.warn(
        `[rds] ignore writePlatformMatches([]) for ${plat}`
        + (plat === "Polymarket" ? " (use prune)" : " (sticky snapshot)"),
      );
      return;
    }
    _writeRds(pool => _rdsClearPlatformMatchSnapshot(pool, plat), "platform_matches", {
      key: collectorMatchesWriteKey(plat),
    });
    return;
  }
  const rows = mapPlatformMatchRows(provider, matchs);
  _writeRds(
    pool => _rdsUpsertPlatformMatches(pool, rows, opts),
    "platform_matches",
    { key: collectorMatchesWriteKey(provider) },
  );
}

/** await 版：与 replacePlatformBetsForMatchAsync 配对
 * @param {string} provider
 * @param {object[]} matchs
 * @param {{ alsoKeepSourceMatchIds?: string[] }} [opts]
 */
export async function writePlatformMatchesAsync(provider, matchs, opts = {}) {
  if (!Array.isArray(matchs))
    return;
  const plat = String(provider);
  if (!matchs.length) {
    if (shouldIgnoreEmptyPlatformMatchSnapshot(plat)) {
      console.warn(
        `[rds] ignore writePlatformMatchesAsync([]) for ${plat}`
        + (plat === "Polymarket" ? " (use prune)" : " (sticky snapshot)"),
      );
      return;
    }
    await _writeRdsAsync(pool => _rdsClearPlatformMatchSnapshot(pool, plat), "platform_matches");
    return;
  }
  const rows = mapPlatformMatchRows(provider, matchs);
  await _writeRdsAsync(pool => _rdsUpsertPlatformMatches(pool, rows, opts), "platform_matches");
}

/**
 * Polymarket 显式 prune：ended/closed id ∪ synced_at 过旧。
 * @param {{
 *   forceDeleteIds?: string[],
 *   staleBeforeMs?: number,
 * }} [opts]
 * @returns {Promise<string[]>} 删除的 source_match_id
 */
export async function prunePolymarketPlatformMatches(opts = {}) {
  const pool = getPgPool();
  if (!pool)
    return [];
  try {
    return await _rdsPrunePolymarketPlatformMatches(pool, opts);
  }
  catch (err) {
    console.warn("[rds:platform_matches_prune]", err.message);
    throw err;
  }
}

/**
 * PredictFun 显式清理：Match Winner 已提案/结算的 category id（forceDeleteIds）。
 * 与 PM 不同：不做 synced_at stale 扫（PF 写路径已有 orphan 删）。
 * @param {{ forceDeleteIds?: string[] }} [opts]
 * @returns {Promise<string[]>} 删除的 source_match_id
 */
async function _rdsPrunePredictFunPlatformMatches(pool, opts = {}) {
  const forceDelete = Array.isArray(opts.forceDeleteIds)
    ? [...new Set(opts.forceDeleteIds.map(String).filter(Boolean))]
    : [];
  if (!forceDelete.length)
    return [];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const moved = await client.query(
      `WITH moved AS (
         DELETE FROM platform_matches
         WHERE platform = 'PredictFun'
           AND source_match_id = ANY($1::text[])
         RETURNING *
       )
       INSERT INTO platform_matches_history (
         platform, source_match_id, source_game_id, start_time, home_id, home,
         away_id, away, bo, is_live, rot_num, teams, synced_at, match_id
       )
       SELECT platform, source_match_id, source_game_id, start_time, home_id, home,
              away_id, away, bo, is_live, rot_num, teams, synced_at, match_id
       FROM moved
       RETURNING source_match_id`,
      [forceDelete],
    );
    const deletedIds = moved.rows.map(r => String(r.source_match_id));
    if (deletedIds.length) {
      await client.query(
        `DELETE FROM platform_bets
         WHERE platform = 'PredictFun' AND source_match_id = ANY($1::text[])`,
        [deletedIds],
      );
      await client.query(
        `DELETE FROM live_timers
         WHERE platform = 'PredictFun' AND source_match_id = ANY($1::text[])`,
        [deletedIds],
      );
    }
    await client.query("COMMIT");
    return deletedIds;
  }
  catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
  finally {
    client.release();
  }
}

export async function prunePredictFunPlatformMatches(opts = {}) {
  const pool = getPgPool();
  if (!pool)
    return [];
  try {
    return await _rdsPrunePredictFunPlatformMatches(pool, opts);
  }
  catch (err) {
    console.warn("[rds:platform_matches_prune_predictfun]", err.message);
    throw err;
  }
}

/** 开赛早于该阈值的平台赛一律 prune（默认 6h，与 PM/PF 采集主窗 past 一致） */
export const PLATFORM_MATCH_PAST_PRUNE_MS = 6 * 60 * 60 * 1000;

/**
 * 全平台：start_time < cutoff 的 platform_matches → history，并清 bets/timers。
 * @param {{ cutoffMs?: number, nowMs?: number }} [opts]
 * @returns {Promise<{ cutoff: number, deleted: number, byPlatform: Record<string, number> }>}
 */
async function _rdsPrunePlatformMatchesByStartBefore(pool, opts = {}) {
  const now = Number.isFinite(Number(opts.nowMs)) ? Number(opts.nowMs) : Date.now();
  const cutoff = Number.isFinite(Number(opts.cutoffMs))
    ? Number(opts.cutoffMs)
    : now - PLATFORM_MATCH_PAST_PRUNE_MS;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const moved = await client.query(
      `WITH moved AS (
         DELETE FROM platform_matches
         WHERE start_time IS NOT NULL AND start_time < $1::bigint
         RETURNING *
       )
       INSERT INTO platform_matches_history (
         platform, source_match_id, source_game_id, start_time, home_id, home,
         away_id, away, bo, is_live, rot_num, teams, synced_at, match_id
       )
       SELECT platform, source_match_id, source_game_id, start_time, home_id, home,
              away_id, away, bo, is_live, rot_num, teams, synced_at, match_id
       FROM moved
       RETURNING platform, source_match_id`,
      [cutoff],
    );
    const deletedRows = moved.rows || [];
    const byPlatform = {};
    const idsByPlatform = new Map();
    for (const r of deletedRows) {
      const plat = String(r.platform || "");
      byPlatform[plat] = (byPlatform[plat] || 0) + 1;
      if (!idsByPlatform.has(plat))
        idsByPlatform.set(plat, []);
      idsByPlatform.get(plat).push(String(r.source_match_id));
    }
    for (const [plat, ids] of idsByPlatform) {
      if (!ids.length)
        continue;
      await client.query(
        `DELETE FROM platform_bets
         WHERE platform = $1 AND source_match_id = ANY($2::text[])`,
        [plat, ids],
      );
      await client.query(
        `DELETE FROM live_timers
         WHERE platform = $1 AND source_match_id = ANY($2::text[])`,
        [plat, ids],
      );
    }
    await client.query("COMMIT");
    return { cutoff, deleted: deletedRows.length, byPlatform };
  }
  catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
  finally {
    client.release();
  }
}

export async function prunePlatformMatchesByStartBefore(opts = {}) {
  const pool = getPgPool();
  if (!pool)
    return { cutoff: 0, deleted: 0, byPlatform: {} };
  try {
    return await _rdsPrunePlatformMatchesByStartBefore(pool, opts);
  }
  catch (err) {
    console.warn("[rds:platform_matches_past_prune]", err.message);
    throw err;
  }
}

/**
 * 活跃 client_matches：开赛早于 cutoff → 写 ended_at（不搬 history）。
 * @param {{ cutoffMs?: number, nowMs?: number, endedAt?: number }} [opts]
 */
export async function markClientMatchesEndedByStartBefore(opts = {}) {
  const pool = getPgPool();
  if (!pool)
    return { cutoff: 0, ended: 0 };
  const now = Number.isFinite(Number(opts.nowMs)) ? Number(opts.nowMs) : Date.now();
  const cutoff = Number.isFinite(Number(opts.cutoffMs))
    ? Number(opts.cutoffMs)
    : now - PLATFORM_MATCH_PAST_PRUNE_MS;
  const endedAt = Number.isFinite(Number(opts.endedAt)) ? Number(opts.endedAt) : now;
  try {
    const { rowCount } = await pool.query(
      `UPDATE client_matches
       SET ended_at = COALESCE(ended_at, $2)
       WHERE ended_at IS NULL
         AND start_time IS NOT NULL
         AND start_time < $1::bigint`,
      [cutoff, endedAt],
    );
    return { cutoff, ended: rowCount ?? 0 };
  }
  catch (err) {
    console.warn("[rds:client_matches_past_end]", err.message);
    throw err;
  }
}

/** 开赛早于采集 past 窗的比赛：平台行 prune + 合场行标 ended（默认 6h） */
export async function pruneMatchesOlderThanCollectPast(opts = {}) {
  const now = Number.isFinite(Number(opts.nowMs)) ? Number(opts.nowMs) : Date.now();
  const cutoff = Number.isFinite(Number(opts.cutoffMs))
    ? Number(opts.cutoffMs)
    : now - PLATFORM_MATCH_PAST_PRUNE_MS;
  const platform = await prunePlatformMatchesByStartBefore({ cutoffMs: cutoff, nowMs: now });
  const client = await markClientMatchesEndedByStartBefore({
    cutoffMs: cutoff,
    nowMs: now,
    endedAt: now,
  });
  return { cutoff, platform, client };
}

/** @deprecated 使用 pruneMatchesOlderThanCollectPast */
export async function pruneMatchesOlderThanTwoDays(opts = {}) {
  return pruneMatchesOlderThanCollectPast(opts);
}

/** 启动时读取 platform_matches，按平台分组，返回可直接传给 store.saveMatches 的格式 */
export async function fetchPlatformMatches() {
  const pool = getPgPool();
  if (!pool)
    return {};
  try {
    return await _rdsFetchPlatformMatches(pool);
  }
  catch (err) {
    console.warn("[rds] fetchPlatformMatches 失败:", err.message);
    return {};
  }
}

/** matcher 快照缓存使用：轻量判断采集表是否变化 */
export async function fetchPlatformCollectorMeta() {
  const pool = getPgPool();
  if (!pool)
    return null;
  try {
    return await _rdsFetchPlatformCollectorMeta(pool);
  }
  catch (err) {
    console.warn("[rds] fetchPlatformCollectorMeta 失败:", err.message);
    return null;
  }
}

/** 从 RDS 读取 platform_bets，重组为 store._bets 格式 */
export async function fetchPlatformBets() {
  const pool = getPgPool();
  if (!pool)
    return {};
  try {
    return await _rdsFetchPlatformBets(pool);
  }
  catch (err) {
    console.warn("[rds] fetchPlatformBets 失败:", err.message);
    return {};
  }
}

/** 从 RDS 读取 live_timers，重组为 store._timers 格式 */
export async function fetchLiveTimers() {
  const pool = getPgPool();
  if (!pool)
    return {};
  try {
    return await _rdsFetchLiveTimers(pool);
  }
  catch (err) {
    console.warn("[rds] fetchLiveTimers 失败:", err.message);
    return {};
  }
}

/** SaveBet → platform_bets 行（A8 协议无 group_name；MarketID 为 PF 等扩展；LineID 为 PB 扩展） */
function mapSaveBetRows(provider, matchId, bets) {
  const now = Date.now();
  const rawRows = (bets || [])
    .filter(b => b && b.SourceBetID != null && !String(b.BetName ?? "").includes("+"))
    .map(b => {
      const marketId = String(b.MarketID ?? b.market_id ?? "").trim();
      const lineId = Number(b.LineID ?? b.line_id) || 0;
      return {
        platform: String(provider),
        source_bet_id: String(b.SourceBetID),
        source_match_id: String(matchId),
        map: Number(b.Map ?? 0),
        bet_name: String(b.BetName || ""),
        source_home_id: String(b.SourceHomeID ?? b.source_home_id ?? "") || null,
        source_away_id: String(b.SourceAwayID ?? b.source_away_id ?? "") || null,
        market_id: marketId || null,
        line_id: lineId > 0 ? lineId : null,
        home_odds: Number(b.HomeOdds) || 0,
        away_odds: Number(b.AwayOdds) || 0,
        is_locked: b.Status !== "Normal",
        updated_at: now,
      };
    });
  const seen = new Map();
  for (const row of rawRows) seen.set(`${row.source_match_id}:${row.source_bet_id}`, row);
  return [...seen.values()];
}

/** fire-and-forget：upsert 平台盘口赔率（空数组刷新 updated_at 时用） */
export function writePlatformBets(provider, matchId, bets) {
  const rows = mapSaveBetRows(provider, matchId, bets);
  if (!rows.length)
    return;
  _writeRds(pool => _rdsUpsertPlatformBets(pool, rows), "platform_bets", {
    key: collectorBetsWriteKey(provider, matchId),
  });
}

/** [A8 可证实] 每场 saveBets 为完整快照：先删该场旧行再 upsert */
export function replacePlatformBetsForMatch(provider, matchId, bets) {
  const rows = mapSaveBetRows(provider, matchId, bets);
  if (!rows.length)
    return;
  const plat = String(provider);
  const mid = String(matchId);
  _writeRds(pool => _rdsReplacePlatformBets(pool, plat, mid, rows), "platform_bets", {
    key: collectorBetsWriteKey(plat, mid),
  });
}

/** await 版：collector 等需在 cycle 结束前落库时用，避免 fire-and-forget 被下轮覆盖前未完成 */
export async function replacePlatformBetsForMatchAsync(provider, matchId, bets) {
  const rows = mapSaveBetRows(provider, matchId, bets);
  if (!rows.length)
    return;
  const plat = String(provider);
  const mid = String(matchId);
  await _writeRdsAsync(
    pool => _rdsReplacePlatformBets(pool, plat, mid, rows),
    "platform_bets",
  );
}

/**
 * PredictFun 等 VPS collector：map0 / map1 / map2 按 source_bet_id 独立 upsert，
 * 再删本场不在本批的旧 bet_id。避免「先清空整场」导致只有 map0 的写入抹掉地图盘。
 */
export async function syncPlatformBetsForMatchAsync(provider, matchId, bets) {
  const rows = mapSaveBetRows(provider, matchId, bets);
  if (!rows.length)
    return;
  const plat = String(provider);
  const mid = String(matchId);
  await _writeRdsAsync(
    pool => _rdsSyncPlatformBetsForMatch(pool, plat, mid, rows),
    "platform_bets",
  );
}

/** 删除某平台在 keepSourceMatchIds 之外的 platform_bets（collector cycle 末尾调用） */
export async function deleteOrphanPlatformBetsAsync(provider, keepSourceMatchIds) {
  const plat = String(provider);
  const ids = (keepSourceMatchIds || []).map(String);
  await _writeRdsAsync(async (pool) => {
    if (!ids.length) {
      await pool.query(`DELETE FROM platform_bets WHERE platform = $1`, [plat]);
      return;
    }
    await pool.query(
      `DELETE FROM platform_bets
       WHERE platform = $1 AND NOT (source_match_id = ANY($2::text[]))`,
      [plat, ids],
    );
  }, "platform_bets_orphan");
}

/** fire-and-forget：全量替换某平台 timer 快照（对齐 A8 getTimer 整包提交；空数组清空该平台） */
export function writeLiveTimers(provider, timer) {
  const mapped = _mapLiveTimerRows(provider, timer);
  if (!mapped)
    return;
  const { plat, rows } = mapped;
  _writeRds(pool => _rdsReplaceLiveTimersForPlatform(pool, plat, rows), "live_timers", {
    key: collectorTimersWriteKey(plat),
  });
}

/** await 写入完成（API_SaveLiveTimer 使用，避免紧随其后的 GetMatchs 读到旧 RDS） */
export async function writeLiveTimersAsync(provider, timer) {
  const mapped = _mapLiveTimerRows(provider, timer);
  if (!mapped)
    return;
  const { plat, rows } = mapped;
  await _writeRdsAsync(pool => _rdsReplaceLiveTimersForPlatform(pool, plat, rows), "live_timers");
}

/** 运维/部署：清空某平台 live_timers（等待下次 saveLiveTimer 或 matcher matchMerge 刷新 Round） */
export async function purgePlatformLiveTimers(platform) {
  const plat = String(platform || "").trim();
  if (!plat)
    throw new Error("platform required");
  await _writeRdsAsync(pool => _rdsReplaceLiveTimersForPlatform(pool, plat, []), "live_timers");
}
