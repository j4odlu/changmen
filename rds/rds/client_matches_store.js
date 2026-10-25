/**
 * client_matches 表 — matcher matchMerge 写入与 backend 读取。
 * 生命周期：ended_at NULL = 活跃（Client_GetMatchs）；非空 = 已结束（保留行与 matchs，不搬 history）。
 */

import { _jsonb, _writeRds, getPgPool } from "./common.js";

/** 上次写入的活跃 id 集合（ended_at IS NULL），供 fire-and-forget 路径差量标 ended */
let _lastWrittenIds = new Set();
let _lastWrittenIdsInitPromise = null;
let _lastWrittenIdsInitialized = false;

/**
 * gb 写库编码：
 * - null/undefined/"" → SQL NULL 入参，UPSERT 时 **保留**旧锁（legacy 安全）
 * - 0 → 哨兵，UPSERT 时 **清空**锁（仅 projector clearLock）
 * - >0 → 写入该 id
 */
function _gbTeamIdForDb(value) {
  if (value == null || value === "")
    return null;
  const n = Number(value);
  if (n === 0)
    return 0;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** UPSERT：0=清空；非空=覆盖；NULL 入参=保留旧值（生产 legacy 勿误清锁） */
const GB_TEAM_ID_UPSERT_SQL = `
      home_gb_team_id = CASE
        WHEN EXCLUDED.home_gb_team_id = 0 THEN NULL
        WHEN EXCLUDED.home_gb_team_id IS NOT NULL THEN EXCLUDED.home_gb_team_id
        ELSE client_matches.home_gb_team_id
      END,
      away_gb_team_id = CASE
        WHEN EXCLUDED.away_gb_team_id = 0 THEN NULL
        WHEN EXCLUDED.away_gb_team_id IS NOT NULL THEN EXCLUDED.away_gb_team_id
        ELSE client_matches.away_gb_team_id
      END`;

function _endedAtForDb(row) {
  if (row?.ended_at == null || row.ended_at === "")
    return null;
  const n = Number(row.ended_at);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function _buildUpsertParams(dedupedRows) {
  return [
    dedupedRows.map(r => Number(r.id)),
    dedupedRows.map(r => (r.merge_key != null ? String(r.merge_key) : null)),
    dedupedRows.map(r => String(r.title || "")),
    dedupedRows.map(r => (r.game != null ? String(r.game) : null)),
    dedupedRows.map(r => (r.game_id != null ? String(r.game_id) : null)),
    dedupedRows.map(r => (r.start_time != null ? Number(r.start_time) : null)),
    dedupedRows.map(r => (r.bo != null ? Number(r.bo) : null)),
    dedupedRows.map(r => (r.round != null ? Number(r.round) : null)),
    dedupedRows.map(r => Number(r.round_start) || 0),
    dedupedRows.map(r => _jsonb(r.matchs, {})),
    dedupedRows.map(r => _jsonb(r.bets, [])),
    dedupedRows.map(r => _jsonb(r.reverse, [])),
    dedupedRows.map(r => Number(r.built_at)),
    dedupedRows.map(r => (r.pm_sport != null ? _jsonb(r.pm_sport, null) : null)),
    dedupedRows.map(r => _gbTeamIdForDb(r.home_gb_team_id)),
    dedupedRows.map(r => _gbTeamIdForDb(r.away_gb_team_id)),
    dedupedRows.map(r => _endedAtForDb(r)),
  ];
}

const UPSERT_SQL = `
    INSERT INTO client_matches (
      id, merge_key, title, game, game_id, start_time, bo, round, round_start,
      matchs, bets, reverse, built_at, pm_sport, home_gb_team_id, away_gb_team_id, ended_at
    )
    SELECT * FROM unnest(
      $1::bigint[], $2::text[], $3::text[], $4::text[], $5::text[],
      $6::bigint[], $7::integer[], $8::integer[], $9::bigint[],
      $10::jsonb[], $11::jsonb[], $12::jsonb[], $13::bigint[], $14::jsonb[],
      $15::bigint[], $16::bigint[], $17::bigint[]
    )
    ON CONFLICT (id) DO UPDATE SET
      merge_key = EXCLUDED.merge_key,
      title = EXCLUDED.title,
      game = EXCLUDED.game,
      game_id = EXCLUDED.game_id,
      start_time = EXCLUDED.start_time,
      bo = EXCLUDED.bo,
      round = EXCLUDED.round,
      round_start = EXCLUDED.round_start,
      matchs = EXCLUDED.matchs,
      bets = EXCLUDED.bets,
      reverse = EXCLUDED.reverse,
      built_at = EXCLUDED.built_at,
      pm_sport = COALESCE(EXCLUDED.pm_sport, client_matches.pm_sport),
      ${GB_TEAM_ID_UPSERT_SQL},
      -- sticky：一旦 ended_at 有值，UPSERT 不得清掉（仅 clearClientMatchEndedAt 可恢复）
      ended_at = CASE
        WHEN client_matches.ended_at IS NOT NULL THEN client_matches.ended_at
        WHEN EXCLUDED.ended_at IS NOT NULL THEN EXCLUDED.ended_at
        ELSE NULL
      END
  `;

/**
 * M1：结束只信调用方补丁，写库不再「库活跃 − 本拍活跃」自行猜 end。
 * @param {number[]} markEndedIds
 * @param {Set<number>|number[]} writtenActiveIds 本拍仍写入活跃集的 id
 */
export function resolveLifecycleMarkIds(markEndedIds, writtenActiveIds) {
  const active = writtenActiveIds instanceof Set
    ? writtenActiveIds
    : new Set([...(writtenActiveIds || [])].map(Number).filter(id => Number.isFinite(id) && id > 0));
  return [...new Set((markEndedIds || []).map(Number))]
    .filter(id => Number.isFinite(id) && id > 0 && !active.has(id));
}

/**
 * @param {object} pool
 * @param {{ activeRows: object[], endedRows: object[], markEndedIds: number[], builtAt: number }} payload
 */
async function _rdsWriteClientMatchesLifecycle(pool, payload) {
  const {
    activeRows = [],
    endedRows = [],
    markEndedIds = [],
    builtAt = Date.now(),
  } = payload;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const writtenActiveIds = new Set(
      activeRows.map(r => Number(r.id)).filter(id => Number.isFinite(id) && id > 0),
    );
    const endedWriteIds = new Set(
      endedRows.map(r => Number(r.id)).filter(id => Number.isFinite(id) && id > 0),
    );

    // 去掉与 ended 重叠的 active，避免同 id 先清后标的乱序
    const safeActiveRows = activeRows.filter(r => !endedWriteIds.has(Number(r.id)));
    const safeEndedRows = endedRows.filter(r => Number.isFinite(Number(r.id)) && Number(r.id) > 0);

    if (safeActiveRows.length) {
      await client.query(UPSERT_SQL, _buildUpsertParams(safeActiveRows));
    }
    if (safeEndedRows.length) {
      await client.query(UPSERT_SQL, _buildUpsertParams(safeEndedRows));
    }

    // 仅 payload.markEndedIds（M1：不再扫表差量猜归档）
    const markIds = resolveLifecycleMarkIds(markEndedIds, writtenActiveIds);

    if (markIds.length) {
      await client.query(
        `UPDATE client_matches
         SET ended_at = COALESCE(ended_at, $2)
         WHERE id = ANY($1::bigint[]) AND ended_at IS NULL`,
        [markIds, Number(builtAt) || Date.now()],
      );
    }

    await client.query("COMMIT");
    _lastWrittenIds = writtenActiveIds;
    _lastWrittenIdsInitialized = true;
  }
  catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
  finally {
    client.release();
  }
}

const CLIENT_MATCH_META_SQL = `SELECT COUNT(*)::int AS count,
  COALESCE(MAX(built_at), 0)::bigint AS built_at,
  COALESCE(MAX((pm_sport->>'updatedAt')::bigint), 0)::bigint AS pm_sport_rev,
  md5(COALESCE(string_agg(id::text || ':' || row_revision, ',' ORDER BY id), '')) AS version
  FROM active`;

function clientMatchMeta(row = {}) {
  return {
    builtAt: Number(row.built_at) || 0, count: Number(row.count) || 0,
    pmSportRev: Number(row.pm_sport_rev) || 0,
    version: row.version || "d41d8cd98f00b204e9800998ecf8427e",
  };
}

async function _rdsFetchClientMatches(pool, snapshot = false, includeEnded = false) {
  if (snapshot) {
    // One MVCC statement: metadata can never describe a later set of rows.
    // Keep pg's bigint string decoding (JSON aggregation would lose precision).
    const { rows } = await pool.query(`WITH active AS MATERIALIZED (
      SELECT *, xmin::text AS row_revision FROM client_matches ${includeEnded ? "" : "WHERE ended_at IS NULL"}
    ), meta AS (${CLIENT_MATCH_META_SQL})
    SELECT active.*, meta.count AS _snapshot_count, meta.built_at AS _snapshot_built_at,
      meta.pm_sport_rev AS _snapshot_pm_sport_rev, meta.version AS _snapshot_version
    FROM active CROSS JOIN meta ORDER BY start_time ASC NULLS LAST`);
    const first = rows[0];
    const meta = clientMatchMeta(first && {
      count: first._snapshot_count, built_at: first._snapshot_built_at,
      pm_sport_rev: first._snapshot_pm_sport_rev, version: first._snapshot_version,
    });
    return { ...meta, rows: rows.map(({ row_revision, _snapshot_count, _snapshot_built_at,
      _snapshot_pm_sport_rev, _snapshot_version, ...row }) => row) };
  }
  const { rows } = await pool.query(
    `SELECT * FROM client_matches
     WHERE ended_at IS NULL
     ORDER BY start_time ASC NULLS LAST`,
  );
  return rows;
}

/** 合场身份：含已结束行 */
async function _rdsFetchClientMatchesAll(pool) {
  const { rows } = await pool.query(
    `SELECT * FROM client_matches
     ORDER BY start_time ASC NULLS LAST`,
  );
  return rows;
}

async function _rdsFetchClientMatchesMeta(pool) {
  const { rows } = await pool.query(
    `WITH active AS (SELECT id, built_at, pm_sport, xmin::text AS row_revision
     FROM client_matches WHERE ended_at IS NULL) ${CLIENT_MATCH_META_SQL}`,
  );
  return clientMatchMeta(rows[0]);
}

async function _rdsInitLastWrittenIds(pool) {
  const { rows } = await pool.query(
    "SELECT id FROM client_matches WHERE ended_at IS NULL",
  );
  _lastWrittenIds = new Set(rows.map(r => Number(r.id)));
  _lastWrittenIdsInitialized = true;
  console.log(`[rds] 已从 client_matches 加载 ${_lastWrittenIds.size} 条活跃 id`);
}

function _dedupeClientMatchRows(rows) {
  const seen = new Map();
  for (const row of rows) seen.set(Number(row.id), row);
  return [...seen.values()];
}

/** @param {object|object[]} rowsOrPayload @param {number} [builtAt] */
export function normalizeClientMatchesWritePayload(rowsOrPayload, builtAt = Date.now()) {
  if (rowsOrPayload && !Array.isArray(rowsOrPayload) && typeof rowsOrPayload === "object") {
    const activeRows = _dedupeClientMatchRows(
      (rowsOrPayload.activeRows || []).map(r => ({ ...r, ended_at: null })),
    );
    const endedRows = _dedupeClientMatchRows(
      (rowsOrPayload.endedRows || []).map(r => ({
        ...r,
        ended_at: _endedAtForDb(r) || Number(builtAt) || Date.now(),
      })),
    );
    const activeIds = new Set(activeRows.map(r => Number(r.id)));
    const endedIds = new Set(endedRows.map(r => Number(r.id)));
    // 对象补丁：只信传入的 markEndedIds，不根据「库/上次活跃差集」发明 end
    const markEndedIds = (rowsOrPayload.markEndedIds || [])
      .map(Number)
      .filter(id => Number.isFinite(id) && id > 0 && !activeIds.has(id) && !endedIds.has(id));
    return {
      activeRows,
      endedRows,
      markEndedIds,
      builtAt: Number(rowsOrPayload.builtAt) || Number(builtAt) || Date.now(),
    };
  }

  if (!Array.isArray(rowsOrPayload))
    return null;
  const activeRows = _dedupeClientMatchRows(
    rowsOrPayload.map(r => ({ ...r, ended_at: null })),
  );
  const activeIds = new Set(activeRows.map(r => Number(r.id)));
  // 旧式全量数组：仍用进程内 _lastWrittenIds 生成 markEnded（不扫库）
  const markEndedIds = [..._lastWrittenIds].filter(id => !activeIds.has(id));
  return {
    activeRows,
    endedRows: [],
    markEndedIds,
    builtAt: Number(builtAt) || Date.now(),
  };
}

/**
 * fire-and-forget：upsert 活跃 + 显式 end 补丁（不搬 history）。
 * 兼容旧调用：传 rows 数组；新调用可传 { activeRows, endedRows, markEndedIds, builtAt }。
 */
export function writeClientMatches(rowsOrPayload) {
  const payload = normalizeClientMatchesWritePayload(rowsOrPayload);
  if (!payload)
    return;
  _writeRds(async (pool) => {
    await _rdsWriteClientMatchesLifecycle(pool, payload);
  }, "client_matches");
}

/** await 写入完成（matcher / matchMerge 使用，避免前端读到上一版） */
export async function writeClientMatchesAsync(rowsOrPayload, builtAt = Date.now()) {
  const payload = normalizeClientMatchesWritePayload(rowsOrPayload, builtAt);
  if (!payload)
    return;
  const pool = getPgPool();
  if (!pool) {
    throw new Error("比赛写入数据库不可用");
  }
  await _rdsWriteClientMatchesLifecycle(pool, payload);
}

/** 启动时预填 _lastWrittenIds（仅活跃） */
export async function initLastWrittenIds() {
  if (_lastWrittenIdsInitialized)
    return;
  if (_lastWrittenIdsInitPromise)
    return _lastWrittenIdsInitPromise;
  const pool = getPgPool();
  if (!pool)
    return;
  _lastWrittenIdsInitPromise = _rdsInitLastWrittenIds(pool)
    .catch((err) => {
      console.warn("[rds] initLastWrittenIds 失败:", err.message);
    })
    .finally(() => {
      _lastWrittenIdsInitPromise = null;
    });
  return _lastWrittenIdsInitPromise;
}

/**
 * 轻量探测 client_matches 是否变化（供 backend 快照缓存失效）。
 * 仅统计活跃行。
 */
export async function fetchClientMatchesMeta() {
  const pool = getPgPool();
  if (!pool)
    return null;
  try {
    return await _rdsFetchClientMatchesMeta(pool);
  }
  catch (err) {
    console.warn("[rds] fetchClientMatchesMeta 失败:", err.message);
    return null;
  }
}

/**
 * 从 RDS 读取活跃 client_matches（ended_at IS NULL），供 Client_GetMatchs。
 */
export async function fetchClientMatches({ snapshot = false } = {}) {
  const pool = getPgPool();
  if (!pool)
    return null;
  try {
    return await _rdsFetchClientMatches(pool, snapshot);
  }
  catch (err) {
    console.warn("[rds] fetchClientMatches 失败:", err.message);
    return null;
  }
}

/**
 * 合场 / 身份：含已结束行。
 */
export async function fetchClientMatchesAll({ snapshot = false } = {}) {
  const pool = getPgPool();
  if (!pool)
    return null;
  try {
    return snapshot ? await _rdsFetchClientMatches(pool, true, true) : await _rdsFetchClientMatchesAll(pool);
  }
  catch (err) {
    console.warn("[rds] fetchClientMatchesAll 失败:", err.message);
    return null;
  }
}

/**
 * align / ID 挂接专用（含 ended）。
 */
async function _rdsFetchClientMatchesForAlign(pool) {
  const { rows } = await pool.query(
    `SELECT id, merge_key, title, game_id, start_time, matchs, ended_at
     FROM client_matches`,
  );
  return rows;
}

export async function fetchClientMatchesForAlign() {
  const pool = getPgPool();
  if (!pool)
    return null;
  try {
    return await _rdsFetchClientMatchesForAlign(pool);
  }
  catch (err) {
    console.warn("[rds] fetchClientMatchesForAlign 失败:", err.message);
    return null;
  }
}
