/**
 * Matcher 数据访问 — 读写均走 RDS（PostgreSQL）。
 */

import { getPgPool, jsonb } from "./common.js";

function pool() {
  return getPgPool();
}

async function rdsQuery(sql, params = []) {
  const p = pool();
  if (!p)
    throw new Error("RDS 未配置");
  return p.query(sql, params);
}

export function isMatcherStoreReady() {
  return !!pool();
}

/** M3：仅活跃行参与 merge_key / 平台重叠身份复用（ended 不得占坑） */
export async function fetchClientMatchIdIndex() {
  const { rows } = await rdsQuery(
    `SELECT id, merge_key, matchs FROM client_matches
     WHERE ended_at IS NULL`,
  );
  return rows.map(r => ({
    id: Number(r.id),
    merge_key: r.merge_key,
    matchs: r.matchs || {},
  }));
}

export async function findClientMatchIdByMergeKey(mergeKey) {
  const key = String(mergeKey || "").trim();
  if (!key)
    return null;
  const { rows } = await rdsQuery(
    `SELECT id FROM client_matches
     WHERE merge_key = $1 AND ended_at IS NULL
     LIMIT 1`,
    [key],
  );
  return rows[0] ? Number(rows[0].id) : null;
}

async function insertClientMatchStubRds(mergeKey, stub) {
  const builtAt = Date.now();
  const params = [
    mergeKey,
    String(stub.title || ""),
    stub.game != null ? String(stub.game) : null,
    stub.game_id != null ? String(stub.game_id) : null,
    Number(stub.start_time) || 0,
    Number(stub.bo) || 0,
    Number(stub.round) || 0,
    Number(stub.round_start) || 0,
    jsonb(stub.matchs, {}),
    jsonb([], []),
    builtAt,
  ];
  const insertSql = `INSERT INTO client_matches (
        merge_key, title, game, game_id, start_time, bo, round, round_start, matchs, bets, built_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11)
      RETURNING id`;

  async function tryInsert() {
    const { rows } = await rdsQuery(insertSql, params);
    return Number(rows[0].id);
  }

  try {
    return await tryInsert();
  }
  catch (err) {
    if (err.code !== "23505")
      throw err;

    // M3：优先复用仍活跃的同 key；勿把 sticky ended id 交回给新场
    const active = await rdsQuery(
      `SELECT id FROM client_matches
       WHERE merge_key = $1 AND ended_at IS NULL
       LIMIT 1`,
      [mergeKey],
    );
    if (active.rows.length)
      return Number(active.rows[0].id);

    // 仅 ended 占坑：改名腾出 merge_key，再 insert 新活场
    await rdsQuery(
      `UPDATE client_matches
       SET merge_key = merge_key || '@ended:' || id::text
       WHERE merge_key = $1 AND ended_at IS NOT NULL`,
      [mergeKey],
    );
    try {
      return await tryInsert();
    }
    catch (err2) {
      if (err2.code !== "23505")
        throw err2;
      const again = await rdsQuery(
        `SELECT id FROM client_matches
         WHERE merge_key = $1 AND ended_at IS NULL
         LIMIT 1`,
        [mergeKey],
      );
      if (again.rows.length)
        return Number(again.rows[0].id);
      throw err2;
    }
  }
}

export async function insertClientMatchStub(mergeKey, stub = {}) {
  const key = String(mergeKey || "").trim();
  if (!key)
    throw new Error("merge_key 不能为空");
  return insertClientMatchStubRds(key, stub);
}

export function getClientMatchIdAdapter() {
  return {
    fetchClientMatchIndex: fetchClientMatchIdIndex,
    insertClientMatchStub,
    findClientMatchIdByMergeKey,
  };
}

export async function fetchPlatformMatchRow(platform, sourceMatchId) {
  const plat = String(platform || "").trim();
  const srcId = String(sourceMatchId || "").trim();
  if (!plat || !srcId)
    return null;
  const { rows } = await rdsQuery(
    `SELECT platform, source_match_id, source_game_id, start_time, home, home_id, away, away_id, bo, teams, match_id, synced_at
     FROM platform_matches WHERE platform = $1 AND source_match_id = $2`,
    [plat, srcId],
  );
  return rows[0] || null;
}

export async function fetchClientMatchRow(id, columns = "*") {
  const cmId = Number(id);
  if (!Number.isFinite(cmId))
    return null;
  const cols
    = columns === "*"
      ? "id, merge_key, title, game, game_id, start_time, bo, round, round_start, matchs, bets, reverse, built_at, home_gb_team_id, away_gb_team_id, ended_at, pm_sport"
      : columns;
  const { rows } = await rdsQuery(`SELECT ${cols} FROM client_matches WHERE id = $1`, [cmId]);
  return rows[0] || null;
}

export async function fetchPlatformMatchesHomeAway() {
  const { rows } = await rdsQuery(
    "SELECT platform, source_match_id, home, away FROM platform_matches",
  );
  return rows;
}

export async function fetchPlatformMatchesDashboard() {
  const { rows } = await rdsQuery(
    `SELECT pm.platform, pm.source_match_id, pm.source_game_id, pm.start_time,
            pm.home, pm.home_id, pm.away, pm.away_id, pm.bo,
            CASE WHEN cm.id IS NULL THEN NULL ELSE pm.match_id END AS match_id,
            pm.synced_at, pm.teams
     FROM platform_matches pm
     LEFT JOIN client_matches cm ON cm.id = pm.match_id
     ORDER BY pm.start_time ASC NULLS LAST`,
  );
  return rows;
}

export async function fetchClientMatchesDashboard() {
  const { rows } = await rdsQuery(
    `SELECT id, title, game, game_id, start_time, bo, round, matchs, bets, reverse, built_at,
            home_gb_team_id, away_gb_team_id, ended_at
     FROM client_matches
     WHERE ended_at IS NULL
     ORDER BY start_time ASC NULLS LAST`,
  );
  return rows;
}

/**
 * 人工连线：合并写入 client_matches.matchs（须在 platform override 之前，否则 persist 校验失败）。
 * @param {number} clientMatchId
 * @param {Record<string, string>} additions platform → source_match_id
 */
export async function patchClientMatchMatchs(clientMatchId, additions) {
  const cmId = Number(clientMatchId);
  if (!Number.isFinite(cmId) || cmId <= 0)
    throw new Error("无效的赛事 ID");
  if (!additions || typeof additions !== "object")
    throw new Error("matchs 补丁不能为空");

  const cm = await fetchClientMatchRow(cmId, "id, matchs");
  if (!cm)
    throw new Error("赛事不存在");

  const merged = { ...(cm.matchs || {}) };
  let changed = false;
  for (const [plat, srcId] of Object.entries(additions)) {
    const platform = String(plat || "").trim();
    const sid = String(srcId ?? "").trim();
    if (!platform || !sid)
      continue;
    if (merged[platform] !== sid) {
      merged[platform] = sid;
      changed = true;
    }
  }
  if (!changed)
    return { id: cmId, matchs: merged, updated: false };

  await rdsQuery(
    "UPDATE client_matches SET matchs = $2::jsonb WHERE id = $1",
    [cmId, jsonb(merged, {})],
  );
  return { id: cmId, matchs: merged, updated: true };
}

export async function setClientMatchPlatformReverse(id, platform, reversed) {
  const cmId = Number(id);
  const plat = String(platform || "").trim();
  if (!Number.isFinite(cmId) || cmId <= 0)
    throw new Error("无效的赛事 ID");
  if (!plat)
    throw new Error("平台不能为空");

  const cm = await fetchClientMatchRow(cmId, "id, matchs, reverse");
  if (!cm)
    throw new Error("赛事不存在");
  const matchs = cm.matchs && typeof cm.matchs === "object" ? cm.matchs : {};
  if (!Object.hasOwn(matchs, plat))
    throw new Error(`赛事 ${cmId} 未关联平台 ${plat}`);

  const reverseSet = new Set(Array.isArray(cm.reverse) ? cm.reverse.map(String) : []);
  if (reversed)
    reverseSet.add(plat);
  else
    reverseSet.delete(plat);

  const nextReverse = [...reverseSet].filter(p => Object.hasOwn(matchs, p));
  await rdsQuery(
    "UPDATE client_matches SET reverse = $2::jsonb WHERE id = $1",
    [cmId, jsonb(nextReverse, [])],
  );
  return { id: cmId, platform: plat, reversed: !!reversed, reverse: nextReverse };
}

/** client_match_id → { platform → force_aligned | force_reversed } */
export async function fetchClientMatchPlatformOverrides() {
  const { rows } = await rdsQuery(
    `SELECT client_match_id, platform, mode
     FROM client_match_platform_overrides`,
  );
  const byClient = {};
  for (const r of rows || []) {
    const cmId = Number(r.client_match_id);
    if (!Number.isFinite(cmId) || cmId <= 0)
      continue;
    if (!byClient[cmId])
      byClient[cmId] = {};
    byClient[cmId][String(r.platform)] = String(r.mode);
  }
  return byClient;
}

/**
 * @param {'force_aligned'|'force_reversed'|null} mode null 删除覆盖，走 reconcile 自动判定
 */
export async function setClientMatchPlatformSideOverride(clientMatchId, platform, mode) {
  const cmId = Number(clientMatchId);
  const plat = String(platform || "").trim();
  if (!Number.isFinite(cmId) || cmId <= 0)
    throw new Error("无效的赛事 ID");
  if (!plat)
    throw new Error("平台不能为空");

  const cm = await fetchClientMatchRow(cmId, "id, matchs");
  if (!cm)
    throw new Error("赛事不存在");
  const matchs = cm.matchs && typeof cm.matchs === "object" ? cm.matchs : {};
  if (!Object.hasOwn(matchs, plat))
    throw new Error(`赛事 ${cmId} 未关联平台 ${plat}`);

  if (!mode) {
    await rdsQuery(
      `DELETE FROM client_match_platform_overrides
       WHERE client_match_id = $1 AND platform = $2`,
      [cmId, plat],
    );
    return { id: cmId, platform: plat, mode: null };
  }

  const normalized = String(mode);
  if (normalized !== "force_aligned" && normalized !== "force_reversed")
    throw new Error("mode 须为 force_aligned 或 force_reversed");

  await rdsQuery(
    `INSERT INTO client_match_platform_overrides (client_match_id, platform, mode)
     VALUES ($1, $2, $3)
     ON CONFLICT (client_match_id, platform)
     DO UPDATE SET mode = EXCLUDED.mode, updated_at = now()`,
    [cmId, plat, normalized],
  );
  return { id: cmId, platform: plat, mode: normalized };
}

/**
 * 对调场次 canonical 主客 gb 锁（Title 主客对调）；下轮 merge 按新锁重算 Reverse。
 * 同时清除该场次全部 platform_overrides，避免与新锁冲突。
 */
export async function swapClientMatchGbOrientation(clientMatchId) {
  const cmId = Number(clientMatchId);
  if (!Number.isFinite(cmId) || cmId <= 0)
    throw new Error("无效的赛事 ID");

  const cm = await fetchClientMatchRow(cmId, "id, title, home_gb_team_id, away_gb_team_id");
  if (!cm)
    throw new Error("赛事不存在");

  const homeGb = cm.home_gb_team_id != null ? String(cm.home_gb_team_id).trim() : "";
  const awayGb = cm.away_gb_team_id != null ? String(cm.away_gb_team_id).trim() : "";
  if (!homeGb || !awayGb)
    throw new Error("赛事尚未锁定主客 gb，无法对调");
  if (homeGb === awayGb)
    throw new Error("主客 gb 相同，无法对调");

  let title = String(cm.title || "").trim();
  const m = title.match(/^(.+?)\s+vs\s+(.+)$/i);
  if (m)
    title = `${m[2].trim()} vs ${m[1].trim()}`;

  await rdsQuery(
    `UPDATE client_matches
     SET home_gb_team_id = $2, away_gb_team_id = $3, title = $4
     WHERE id = $1`,
    [cmId, awayGb, homeGb, title],
  );
  await rdsQuery(
    `DELETE FROM client_match_platform_overrides WHERE client_match_id = $1`,
    [cmId],
  );

  return {
    id: cmId,
    home_gb_team_id: awayGb,
    away_gb_team_id: homeGb,
    title,
  };
}

export async function fetchClientMatchesHidden() {
  const { rows } = await rdsQuery(
    `SELECT id, merge_key, title, game, game_id, start_time, bo, round, matchs, bets, reverse,
            built_at, ended_at, home_gb_team_id, away_gb_team_id
     FROM client_matches
     WHERE ended_at IS NOT NULL
     ORDER BY ended_at DESC NULLS LAST
     LIMIT 100`,
  );
  return rows;
}

/**
 * 已结束场馆明细：优先活跃 platform_matches，缺失时回落 history（队名/平台 id）。
 * @param {Array<{ id: number, matchs?: Record<string, string> }>} clientRows
 */
export async function fetchPlatformMatchesForHiddenClientMatches(clientRows) {
  const cms = Array.isArray(clientRows) ? clientRows : [];
  if (!cms.length) return [];

  const cmIds = cms.map(r => Number(r.id)).filter(id => Number.isFinite(id) && id > 0);
  const pairKeys = new Set();
  for (const cm of cms) {
    for (const [plat, srcId] of Object.entries(cm.matchs || {})) {
      const p = String(plat || "").trim();
      const s = String(srcId ?? "").trim();
      if (p && s) pairKeys.add(`${p}\0${s}`);
    }
  }

  const byPair = new Map();
  const mergeRow = (r) => {
    const key = `${String(r.platform)}\0${String(r.source_match_id)}`;
    if (!byPair.has(key)) byPair.set(key, r);
  };

  if (cmIds.length) {
    const { rows } = await rdsQuery(
      `SELECT platform, source_match_id, source_game_id, start_time,
              home, home_id, away, away_id, bo, is_live, rot_num, teams, match_id, synced_at
       FROM platform_matches
       WHERE match_id = ANY($1::bigint[])`,
      [cmIds],
    );
    for (const r of rows) mergeRow(r);
  }

  const missing = [...pairKeys].filter(k => !byPair.has(k));
  if (missing.length) {
    const plats = missing.map(k => k.split("\0")[0]);
    const srcs = missing.map(k => k.split("\0")[1]);
    const { rows } = await rdsQuery(
      `SELECT DISTINCT ON (platform, source_match_id)
              platform, source_match_id, source_game_id, start_time,
              home, home_id, away, away_id, bo, is_live, rot_num, teams, match_id, synced_at
       FROM platform_matches
       WHERE (platform, source_match_id) IN (
         SELECT * FROM UNNEST($1::text[], $2::text[]) AS t(platform, source_match_id)
       )
       ORDER BY platform, source_match_id, synced_at DESC NULLS LAST`,
      [plats, srcs],
    );
    for (const r of rows) mergeRow(r);
  }

  const stillMissing = [...pairKeys].filter(k => !byPair.has(k));
  if (stillMissing.length) {
    const plats = stillMissing.map(k => k.split("\0")[0]);
    const srcs = stillMissing.map(k => k.split("\0")[1]);
    const { rows } = await rdsQuery(
      `SELECT DISTINCT ON (platform, source_match_id)
              platform, source_match_id, source_game_id, start_time,
              home, home_id, away, away_id, bo, is_live, rot_num, teams, match_id, synced_at
       FROM platform_matches_history
       WHERE (platform, source_match_id) IN (
         SELECT * FROM UNNEST($1::text[], $2::text[]) AS t(platform, source_match_id)
       )
       ORDER BY platform, source_match_id, archived_at DESC NULLS LAST`,
      [plats, srcs],
    );
    for (const r of rows) mergeRow(r);
  }

  return [...byPair.values()];
}

export async function fetchClientMatchesHiddenCount() {
  const { rows } = await rdsQuery(
    `SELECT COUNT(*)::int AS count
     FROM client_matches
     WHERE ended_at IS NOT NULL`,
  );
  return rows[0]?.count ?? 0;
}

export async function fetchLatestClientMatchBuiltAt() {
  const { rows } = await rdsQuery(
    `SELECT built_at FROM client_matches
     WHERE ended_at IS NULL
     ORDER BY built_at DESC NULLS LAST LIMIT 1`,
  );
  return rows[0]?.built_at ? Number(rows[0].built_at) : 0;
}

/** 强制结束：保留行与 matchs，写 ended_at；不搬 history、不删 platform_* */
export async function forceEndClientMatch(id, endedAt = Date.now()) {
  const cmId = Number(id);
  if (!Number.isFinite(cmId))
    throw new Error("无效的赛事 ID");
  const ts = Number(endedAt) || Date.now();
  const { rowCount } = await rdsQuery(
    `UPDATE client_matches
     SET ended_at = COALESCE(ended_at, $2)
     WHERE id = $1 AND ended_at IS NULL`,
    [cmId, ts],
  );
  if (!rowCount) {
    const existing = await fetchClientMatchRow(cmId, "id, ended_at");
    if (!existing)
      throw new Error("赛事不存在");
    return { id: cmId, ended: true, alreadyEnded: true, ended_at: existing.ended_at };
  }
  return { id: cmId, ended: true, alreadyEnded: false, ended_at: ts };
}

/** 清除 ended_at，重新进入 Client_GetMatchs */
export async function clearClientMatchEndedAt(id) {
  const cmId = Number(id);
  if (!Number.isFinite(cmId))
    throw new Error("无效的赛事 ID");
  const { rowCount } = await rdsQuery(
    `UPDATE client_matches SET ended_at = NULL WHERE id = $1`,
    [cmId],
  );
  if (!rowCount)
    throw new Error("赛事不存在");
  return { id: cmId, ended_at: null };
}

/** @deprecated 使用 forceEndClientMatch；保留别名兼容旧调用 */
export async function archiveClientMatch(id) {
  return forceEndClientMatch(id);
}

export async function fetchPlatformMatchesDebugRows() {
  const { rows } = await rdsQuery(
    "SELECT platform, source_match_id, start_time, home, away, synced_at FROM platform_matches",
  );
  return rows;
}

export async function fetchPlatformMatchesByClientMatchId(cmId) {
  const id = Number(cmId);
  const { rows } = await rdsQuery(
    "SELECT platform, source_match_id FROM platform_matches WHERE match_id = $1",
    [id],
  );
  return rows;
}

/** matchMerge 物化：platform_matches.match_id → client_matches.matchs（RDS 为准） */
export async function fetchAllPlatformMatchBindings() {
  const { rows } = await rdsQuery(
    "SELECT match_id, platform, source_match_id FROM platform_matches WHERE match_id IS NOT NULL",
  );
  const byClientId = new Map();
  for (const r of rows) {
    const cmId = Number(r.match_id);
    if (!Number.isFinite(cmId))
      continue;
    if (!byClientId.has(cmId))
      byClientId.set(cmId, []);
    byClientId.get(cmId).push({
      platform: String(r.platform),
      source_match_id: String(r.source_match_id),
    });
  }
  return byClientId;
}

export async function reassignPlatformMatchIds(fromId, toId) {
  const from = Number(fromId);
  const to = Number(toId);
  await rdsQuery("UPDATE platform_matches SET match_id = $1 WHERE match_id = $2", [to, from]);
}

export async function deletePlatformMatchRow(platform, sourceMatchId) {
  const plat = String(platform || "").trim();
  const srcId = String(sourceMatchId || "").trim();
  await rdsQuery(
    `WITH moved AS (
       DELETE FROM platform_matches WHERE platform = $1 AND source_match_id = $2
       RETURNING *
     )
     INSERT INTO platform_matches_history (platform, source_match_id, source_game_id, start_time, home_id, home, away_id, away, bo, is_live, rot_num, teams, synced_at, match_id)
     SELECT platform, source_match_id, source_game_id, start_time, home_id, home, away_id, away, bo, is_live, rot_num, teams, synced_at, match_id FROM moved`,
    [plat, srcId],
  );
}

export async function deleteClientMatchRow(id) {
  const cmId = Number(id);
  await rdsQuery("DELETE FROM client_matches WHERE id = $1", [cmId]);
}
