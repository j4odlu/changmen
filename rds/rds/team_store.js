/**
 * 队伍表读写 — canonical_teams / team_venue_maps（RDS）。
 */

import { getGameCodeForPlatformId } from "@changmen/shared/catalog/game_catalog";
import { formatPbTeamPlatformId } from "@changmen/shared/catalog/pb_team_platform_id";
import { normalizeTeam, resolveCanonicalTeamName } from "@changmen/match-identity";
import { getPgPool } from "./common.js";
import { readVenueTeamId, resolveVenueTeamIdColumn } from "./team_venue_maps_cols.js";

async function rdsLoadAll(sql, mapRow) {
  const pool = getPgPool();
  if (!pool)
    throw new Error("DATABASE_URL 未配置");
  const PAGE = 1000;
  const result = [];
  for (let off = 0; ; off += PAGE) {
    const { rows } = await pool.query(`${sql} OFFSET $1 LIMIT $2`, [off, PAGE]);
    if (!rows.length)
      break;
    for (const row of rows) result.push(mapRow ? mapRow(row) : row);
    if (rows.length < PAGE)
      break;
  }
  return result;
}

export async function fetchAllCanonicalTeams() {
  return rdsLoadAll(
    "SELECT id, gb_team_id, game, name, acronym FROM canonical_teams ORDER BY id",
    r => ({
      id: r.id,
      gb_team_id: r.gb_team_id,
      game: r.game,
      name: r.name,
      acronym: r.acronym,
    }),
  );
}

/**
 * 队名映射 revision：合场进程用其判断是否需重载内存 plugin。
 * 覆盖 insert / 待识别→已识别（gb 填充）/ 换 gb；不依赖 updated_at 列。
 */
export async function fetchTeamMapsRevision() {
  const pool = getPgPool();
  if (!pool)
    return "0";
  const { rows } = await pool.query(
    `SELECT COUNT(*)::bigint AS n,
            COUNT(gb_team_id)::bigint AS mapped,
            COALESCE(SUM(gb_team_id), 0)::bigint AS gb_sum,
            COALESCE(MAX(id), 0)::bigint AS max_id
     FROM team_venue_maps`,
  );
  const r = rows[0] || {};
  return `${r.n || 0}:${r.mapped || 0}:${r.gb_sum || 0}:${r.max_id || 0}`;
}

export async function fetchAllTeamPlatformMaps() {
  const pool = getPgPool();
  const pidCol = await resolveVenueTeamIdColumn(pool);
  return rdsLoadAll(
    `SELECT gb_team_id, venue, ${pidCol} AS venue_team_id, venue_name FROM team_venue_maps ORDER BY id`,
    r => ({
      gb_team_id: r.gb_team_id,
      venue: r.venue,
      venue_team_id: readVenueTeamId(r),
      venue_name: r.venue_name,
    }),
  );
}

/**
 * 全量读取 team_provider_ids（多数据源 provider 索引）。
 * 供 team-resolver 插件加载 / /health 巡检等使用。
 */
export async function fetchAllTeamProviderIds() {
  return rdsLoadAll(
    `SELECT team_id, provider, provider_id, game, source, confidence
     FROM team_provider_ids ORDER BY team_id, provider`,
    r => ({
      team_id: r.team_id,
      provider: r.provider,
      provider_id: r.provider_id,
      game: r.game,
      source: r.source,
      confidence: Number(r.confidence),
    }),
  );
}

/**
 * 单条查询：某 canonical 队伍在某 provider 下的 ID。
 * @returns {Promise<object|null>}
 */
export async function fetchTeamProviderId(teamId, provider) {
  const id = Number(teamId);
  const p = String(provider || "").trim();
  if (!Number.isFinite(id) || !p)
    return null;
  const pool = getPgPool();
  if (!pool)
    return null;
  const { rows } = await pool.query(
    `SELECT team_id, provider, provider_id, game, source, confidence
     FROM team_provider_ids WHERE team_id = $1 AND provider = $2 LIMIT 1`,
    [id, p],
  );
  if (!rows.length)
    return null;
  const r = rows[0];
  return {
    team_id: r.team_id,
    provider: r.provider,
    provider_id: r.provider_id,
    game: r.game,
    source: r.source,
    confidence: Number(r.confidence),
  };
}

/** @returns {Set<string>} venue:venue_team_id */
export async function fetchExistingTeamMapKeys(candidates) {
  const existing = new Set();
  const byVenue = new Map();
  for (const row of candidates.values()) {
    const venue = row.venue ?? row.platform;
    if (!byVenue.has(venue))
      byVenue.set(venue, []);
    byVenue.get(venue).push(row.venue_team_id ?? row.venue_id);
  }

  const pool = getPgPool();
  if (!pool)
    throw new Error("DATABASE_URL 未配置");
  const pidCol = await resolveVenueTeamIdColumn(pool);
  const BATCH = 200;
  for (const [venue, ids] of byVenue) {
    for (let i = 0; i < ids.length; i += BATCH) {
      const batch = ids.slice(i, i + BATCH);
      const { rows } = await pool.query(
        `SELECT ${pidCol} AS venue_team_id FROM team_venue_maps WHERE venue = $1 AND ${pidCol} = ANY($2::text[])`,
        [venue, batch],
      );
      for (const row of rows) existing.add(`${venue}:${readVenueTeamId(row)}`);
    }
  }
  return existing;
}

function normalizePlatformIdStr(id) {
  if (id == null || id === "")
    return "";
  return String(id).trim();
}

function parseTeamsArrayRaw(teams) {
  if (Array.isArray(teams))
    return teams;
  if (typeof teams === "string") {
    try {
      return JSON.parse(teams);
    }
    catch {
      return [];
    }
  }
  return [];
}

function resolveStoredPlatformTeamId(platform, platformId, sourceGameId, teamGameId, gameCode) {
  const pid = normalizePlatformIdStr(platformId);
  if (!pid)
    return "";
  if (platform === "PB") {
    const gameSlug = String(teamGameId ?? sourceGameId ?? "").trim();
    const code = gameCode || getGameCodeForPlatformId("PB", gameSlug) || null;
    return formatPbTeamPlatformId(gameSlug, pid, code);
  }
  return pid;
}

/** matcher UI 格子与 merge_mode 分栏同源：home_id/away_id → teams[] 按队名/顺序兜底 */
export function resolvePlatformMatchTeamId(row, side, gameCodeHint = null) {
  const platform = String(row?.platform || "").trim();
  const gameCode = gameCodeHint || row?.game?.code || null;
  const sourceGameId = row?.source_game_id ?? row?.SourceGameID ?? "";
  const columnId = normalizePlatformIdStr(side === "home" ? row?.home_id : row?.away_id);
  if (columnId) {
    return resolveStoredPlatformTeamId(platform, columnId, sourceGameId, null, gameCode);
  }
  const name = side === "home" ? row?.home : row?.away;
  const teams = parseTeamsArrayRaw(row?.teams);
  const norm = normalizeTeam(name);
  if (norm && teams.length) {
    const hit = teams.find(t => normalizeTeam(t.Name ?? t.name) === norm);
    if (hit) {
      const id = normalizePlatformIdStr(hit.TeamID ?? hit.team_id ?? hit.teamId ?? hit.id);
      const teamGameId = hit.GameID ?? hit.game_id ?? hit.gameId ?? sourceGameId;
      if (id)
        return resolveStoredPlatformTeamId(platform, id, sourceGameId, teamGameId, gameCode);
    }
  }
  const idx = side === "home" ? 0 : 1;
  const t = teams[idx];
  if (t) {
    const id = normalizePlatformIdStr(t.TeamID ?? t.team_id ?? t.teamId ?? t.id);
    const teamGameId = t.GameID ?? t.game_id ?? t.gameId ?? sourceGameId;
    if (id)
      return resolveStoredPlatformTeamId(platform, id, sourceGameId, teamGameId, gameCode);
  }
  return "";
}

export function lookupTeamMapEntry(teamMaps, platform, platformId, gameCode = null) {
  const p = String(platform || "").trim();
  const pid = normalizePlatformIdStr(platformId);
  if (!p || !pid)
    return null;
  const hit = teamMaps?.[`${p}:${pid}`];
  if (hit)
    return hit;
  if (p === "PB" && gameCode) {
    const atIdx = pid.indexOf("@");
    const raw = atIdx > 0 ? pid.slice(0, atIdx) : pid;
    const viaGame = formatPbTeamPlatformId("", raw, gameCode);
    if (viaGame && viaGame !== pid) {
      const alt = teamMaps?.[`${p}:${viaGame}`];
      if (alt)
        return alt;
    }
  }
  return null;
}

/** 主客平台 id 均在 teamMaps 中有 gb_team_id（非待识别） */
export function isPlatformMatchRowFullyIdMapped(row, teamMaps) {
  const gameCode = row?.game?.code;
  if (!gameCode)
    return false;
  const platform = String(row?.platform || "").trim();
  if (!platform)
    return false;
  for (const side of ["home", "away"]) {
    const pid = resolvePlatformMatchTeamId(row, side, gameCode);
    if (!pid)
      return false;
    const entry = lookupTeamMapEntry(teamMaps, platform, pid, gameCode);
    if (entry?.gb_team_id == null)
      return false;
  }
  return true;
}

function collectNeededTeamIds(allMatches) {
  const byPlatform = new Map();
  const add = (platform, platformId, sourceGameId, teamGameId, gameCode) => {
    const p = String(platform || "").trim();
    const id = resolveStoredPlatformTeamId(p, platformId, sourceGameId, teamGameId, gameCode);
    if (!p || !id)
      return;
    if (!byPlatform.has(p))
      byPlatform.set(p, new Set());
    byPlatform.get(p).add(id);
    if (p === "PB" && gameCode) {
      const raw = normalizePlatformIdStr(platformId);
      if (raw) {
        const viaGame = formatPbTeamPlatformId("", raw, gameCode);
        if (viaGame)
          byPlatform.get(p).add(viaGame);
      }
    }
  };
  for (const m of allMatches || []) {
    const sourceGameId = m.source_game_id ?? m.SourceGameID ?? "";
    const gameCode = m.game?.code || null;
    add(m.platform, m.home_id, sourceGameId, null, gameCode);
    add(m.platform, m.away_id, sourceGameId, null, gameCode);
    for (const t of parseTeamsArrayRaw(m.teams)) {
      const teamGameId = t.GameID ?? t.game_id ?? t.gameId ?? sourceGameId;
      add(m.platform, t.TeamID ?? t.team_id ?? t.teamId ?? t.id, sourceGameId, teamGameId, gameCode);
    }
  }
  return byPlatform;
}

function mergeTeamMapRow(teamMaps, row) {
  const updatedBy = row.canonical_updated_by ?? row.updated_by ?? null;
  const canonicalName = row.canonical_name ?? row.canonical_teams?.name ?? null;
  const entry = {
    gb_team_id: row.gb_team_id != null ? String(row.gb_team_id) : null,
    canonical_name: canonicalName,
    updated_by: updatedBy,
    venue_name: row.venue_name,
    game: row.game,
    pending: row.gb_team_id == null,
  };
  const pid = normalizePlatformIdStr(readVenueTeamId(row));
  if (!pid)
    return;
  const idKey = `${row.venue}:${pid}`;
  const prev = teamMaps[idKey];
  if (!prev || (entry.gb_team_id != null && prev.gb_team_id == null)) {
    teamMaps[idKey] = entry;
  }
}

export async function loadTeamMapsForMatcher(allMatches) {
  const teamMaps = {};
  const neededByPlatform = collectNeededTeamIds(allMatches);
  const pool = getPgPool();
  if (!pool)
    throw new Error("DATABASE_URL 未配置");
  const pidCol = await resolveVenueTeamIdColumn(pool);
  const BATCH = 200;

  for (const [platform, idSet] of neededByPlatform) {
    const ids = [...idSet];
    for (let i = 0; i < ids.length; i += BATCH) {
      const batch = ids.slice(i, i + BATCH);
      const { rows } = await pool.query(
        `SELECT tvm.venue, tvm.${pidCol} AS venue_team_id, tvm.venue_name, tvm.gb_team_id, tvm.game,
                ct.updated_by AS canonical_updated_by, ct.name AS canonical_name
         FROM team_venue_maps tvm
         LEFT JOIN canonical_teams ct ON ct.gb_team_id = tvm.gb_team_id
         WHERE tvm.venue = $1 AND tvm.${pidCol} = ANY($2::text[])`,
        [platform, batch],
      );
      for (const row of rows) mergeTeamMapRow(teamMaps, row);
    }
  }
  return teamMaps;
}

export async function fetchTeamPlatformMap(platform, venueTeamId) {
  const plat = String(platform || "").trim();
  const pid = String(venueTeamId || "").trim();
  if (!plat || !pid)
    return null;

  const pool = getPgPool();
  if (!pool)
    throw new Error("DATABASE_URL 未配置");
  const pidCol = await resolveVenueTeamIdColumn(pool);
  const { rows } = await pool.query(
    `SELECT gb_team_id, venue_name, game FROM team_venue_maps WHERE venue = $1 AND ${pidCol} = $2 LIMIT 1`,
    [plat, pid],
  );
  return rows[0] || null;
}

export async function countTeamMapsForGbId(gbTeamId) {
  const id = Number(gbTeamId);
  if (!Number.isFinite(id))
    return 0;

  const pool = getPgPool();
  if (!pool)
    throw new Error("DATABASE_URL 未配置");
  const { rows } = await pool.query(
    "SELECT COUNT(*)::int AS c FROM team_venue_maps WHERE gb_team_id = $1",
    [id],
  );
  return rows[0]?.c || 0;
}

function isCanonicalNameMapConflict(err) {
  return (
    err?.code === "23505"
    && String(err.message || "").includes("team_venue_maps_gb_team_id_venue_venue_name_key")
  );
}

function formatTeamPlatformMapWriteError(row) {
  return [
    "队伍关联失败：同一 gb_team_id 在该平台已有同名队伍映射",
    `${row.venue} · 「${row.venue_name}」· 场馆队伍 id ${row.venue_team_id}`,
    "请刷新 matcher 页面后重试；若两侧为同一平台且队名相同，同一标准队伍只能保留一个平台 id",
  ].join("\n");
}

/** 手动关联：同 gb_team_id + 平台 + 队名下只保留当前 venue_team_id（旧 id 视为过时） */
async function clearCanonicalPlatformNameConflict(pool, row, pidCol) {
  if (row.gb_team_id == null)
    return;
  await pool.query(
    `DELETE FROM team_venue_maps
     WHERE gb_team_id = $1 AND venue = $2 AND venue_name = $3 AND ${pidCol} <> $4`,
    [row.gb_team_id, row.venue, row.venue_name, String(row.venue_team_id)],
  );
}

async function rdsUpsertTeamPlatformMaps(chunk, { ignoreDuplicates = false } = {}) {
  const pool = getPgPool();
  if (!pool)
    throw new Error("DATABASE_URL 未配置");
  const pidCol = await resolveVenueTeamIdColumn(pool);
  for (const row of chunk) {
    if (row.gb_team_id != null && !ignoreDuplicates) {
      await clearCanonicalPlatformNameConflict(pool, row, pidCol);
    }
    const sql = ignoreDuplicates
      ? `INSERT INTO team_venue_maps (gb_team_id, venue, ${pidCol}, venue_name, game, source, confidence)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (venue, ${pidCol}) DO NOTHING`
      : `INSERT INTO team_venue_maps (gb_team_id, venue, ${pidCol}, venue_name, game, source, confidence)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (venue, ${pidCol}) DO UPDATE SET
           gb_team_id = COALESCE(EXCLUDED.gb_team_id, team_venue_maps.gb_team_id),
           venue_name = EXCLUDED.venue_name,
           game = EXCLUDED.game,
           source = EXCLUDED.source,
           confidence = EXCLUDED.confidence`;
    try {
      await pool.query(sql, [
        row.gb_team_id ?? null,
        row.venue,
        String(row.venue_team_id),
        row.venue_name,
        row.game ?? null,
        row.source ?? "manual",
        row.confidence ?? 1.0,
      ]);
    }
    catch (err) {
      if (isCanonicalNameMapConflict(err)) {
        throw new Error(formatTeamPlatformMapWriteError(row));
      }
      throw err;
    }
  }
}

export async function upsertTeamPlatformMaps(rows, opts = {}) {
  if (!rows?.length)
    return;
  const chunk = rows.map(r => {
    const venueTeamId = String(r.venue_team_id ?? r.venue_id ?? "");
    return {
      gb_team_id: r.gb_team_id ?? null,
      venue: String(r.venue ?? r.platform),
      venue_team_id: venueTeamId,
      venue_name: String(r.venue_name || venueTeamId),
      game: r.game ?? null,
      source: r.source ?? "manual",
      confidence: r.confidence ?? 1.0,
    };
  });
  await rdsUpsertTeamPlatformMaps(chunk, opts);
}

export async function upsertTeamPlatformMapsBatched(rows, batchSize = 200, opts = {}) {
  for (let i = 0; i < rows.length; i += batchSize) {
    await upsertTeamPlatformMaps(rows.slice(i, i + batchSize), opts);
  }
}

async function rdsUpsertCanonicalTeams(chunk) {
  const pool = getPgPool();
  if (!pool)
    throw new Error("DATABASE_URL 未配置");
  for (const row of chunk) {
    await pool.query(
      `INSERT INTO canonical_teams (game, name, acronym, pandascore_id, updated_at)
       VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, now()))
       ON CONFLICT (game, name) DO UPDATE SET
         acronym = EXCLUDED.acronym,
         pandascore_id = EXCLUDED.pandascore_id,
         updated_at = EXCLUDED.updated_at`,
      [
        row.game,
        row.name,
        row.acronym ?? null,
        row.pandascore_id ?? null,
        row.updated_at ?? null,
      ],
    );
  }
}

export async function upsertCanonicalTeams(rows) {
  if (!rows?.length)
    return;
  await rdsUpsertCanonicalTeams(rows);
}

export async function nextManualGbTeamId() {
  const pool = getPgPool();
  if (!pool)
    throw new Error("DATABASE_URL 未配置");
  const { rows } = await pool.query("SELECT next_manual_gb_team_id() AS id");
  return Number(rows[0]?.id);
}

export async function fetchCanonicalTeamExact(gameCode, name) {
  const pool = getPgPool();
  if (!pool)
    throw new Error("DATABASE_URL 未配置");
  const { rows } = await pool.query(
    "SELECT id, gb_team_id, name FROM canonical_teams WHERE game = $1 AND name = $2 LIMIT 1",
    [gameCode, name],
  );
  return rows[0] || null;
}

export async function findCanonicalTeamByNormalizedName(gameCode, norm) {
  const pageSize = 1000;
  const pool = getPgPool();
  if (!pool)
    throw new Error("DATABASE_URL 未配置");
  for (let from = 0; ; from += pageSize) {
    const { rows } = await pool.query(
      "SELECT id, gb_team_id, name FROM canonical_teams WHERE game = $1 ORDER BY id OFFSET $2 LIMIT $3",
      [gameCode, from, pageSize],
    );
    if (!rows.length)
      return null;
    for (const row of rows) {
      if (normalizeTeam(row.name) === norm)
        return row;
    }
    if (rows.length < pageSize)
      return null;
  }
}

export async function updateCanonicalTeamById(id, patch) {
  const rowId = Number(id);
  if (!Number.isFinite(rowId))
    throw new Error("canonical id 无效");

  const pool = getPgPool();
  if (!pool)
    throw new Error("DATABASE_URL 未配置");
  const sets = [];
  const vals = [];
  let n = 1;
  if (patch.gb_team_id != null) {
    sets.push(`gb_team_id = $${n++}`);
    vals.push(patch.gb_team_id);
  }
  if (patch.updated_by != null) {
    sets.push(`updated_by = $${n++}`);
    vals.push(patch.updated_by);
  }
  if (patch.name != null) {
    sets.push(`name = $${n++}`);
    vals.push(String(patch.name).trim());
    sets.push("updated_at = now()");
  }
  if (!sets.length)
    return null;
  vals.push(rowId);
  const { rows } = await pool.query(
    `UPDATE canonical_teams SET ${sets.join(", ")} WHERE id = $${n} RETURNING gb_team_id, name, game`,
    vals,
  );
  return rows[0] || null;
}

export async function insertCanonicalTeam(row) {
  const pool = getPgPool();
  if (!pool)
    throw new Error("DATABASE_URL 未配置");
  const { rows } = await pool.query(
    `INSERT INTO canonical_teams (gb_team_id, game, name, updated_by)
     VALUES ($1, $2, $3, $4)
     RETURNING id, gb_team_id`,
    [row.gb_team_id, row.game, row.name, row.updated_by ?? null],
  );
  return rows[0];
}

export async function reassignGbTeamId(fromId, toId) {
  const from = Number(fromId);
  const to = Number(toId);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === to)
    return 0;

  const pool = getPgPool();
  if (!pool)
    throw new Error("DATABASE_URL 未配置");
  const pidCol = await resolveVenueTeamIdColumn(pool);
  const { rows: loserRows } = await pool.query(
    `SELECT id, venue, ${pidCol} AS venue_team_id, venue_name FROM team_venue_maps WHERE gb_team_id = $1`,
    [from],
  );
  if (!loserRows.length)
    return 0;

  let processed = 0;
  for (const row of loserRows) {
    const { rows: winnerDup } = await pool.query(
      `SELECT id FROM team_venue_maps
       WHERE gb_team_id = $1 AND venue = $2 AND venue_name = $3 LIMIT 1`,
      [to, row.venue, row.venue_name],
    );
    if (winnerDup.length) {
      // 合并 gb_team_id 时，目标侧已有同平台同名映射 → 丢弃 loser 行，避免违反唯一约束
      await pool.query(`DELETE FROM team_venue_maps WHERE id = $1`, [row.id]);
      processed++;
      continue;
    }
    await pool.query(
      `UPDATE team_venue_maps SET gb_team_id = $1, source = 'manual' WHERE id = $2`,
      [to, row.id],
    );
    processed++;
  }
  return processed;
}

/** matchMerge：有 OB 映射时将 canonical_teams.name 同步为 OB venue_name */
export async function syncCanonicalTeamNamesFromOb() {
  const pool = getPgPool();
  if (!pool)
    return { updated: 0, skipped: 0, conflicts: 0 };

  const { rows } = await pool.query(
    `SELECT DISTINCT ON (ct.gb_team_id)
       ct.id, ct.gb_team_id, ct.game, ct.name AS stored_name, tvm.venue_name AS ob_name
     FROM team_venue_maps tvm
     INNER JOIN canonical_teams ct ON ct.gb_team_id = tvm.gb_team_id
     WHERE tvm.venue = 'OB' AND tvm.gb_team_id IS NOT NULL
     ORDER BY ct.gb_team_id, tvm.id ASC`,
  );

  let updated = 0;
  let skipped = 0;
  let conflicts = 0;

  for (const row of rows || []) {
    const target = resolveCanonicalTeamName(row.ob_name, row.stored_name);
    const stored = String(row.stored_name || "").trim();
    if (!target || target === stored) {
      skipped++;
      continue;
    }
    try {
      const res = await updateCanonicalTeamById(row.id, { name: target, updated_by: "OB" });
      if (res)
        updated++;
      else skipped++;
    }
    catch (err) {
      if (err?.code === "23505")
        conflicts++;
      else console.warn("[team_store] syncCanonicalTeamNamesFromOb:", err.message);
      skipped++;
    }
  }

  if (updated > 0) {
    console.log(
      `[team_store] canonical 队名同步 OB · 更新 ${updated} · 跳过 ${skipped}${conflicts ? ` · 冲突 ${conflicts}` : ""}`,
    );
  }
  return { updated, skipped, conflicts };
}

export function saveTeamMappingFireAndForget(row) {
  upsertTeamPlatformMaps([row]).catch(e =>
    console.warn("[team_store] saveMapping 失败:", e.message),
  );
}
