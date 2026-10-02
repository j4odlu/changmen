/**
 * tag_platforms、players、user_logs 表读写。
 * 操盘账号唯一真相：players（含 account_data jsonb）。
 */

import {
  accountRecordToPlayerPatch,
  playerRowToAccountRecord,
} from "../player_account_record.js";
import {
  buildVenueAccountKey,
  isVenueAccountKeyUniqueViolation,
  ownSoftDeletedVenueAccountMessage,
  VenueAccountKeyConflictError,
  venueAccountKeyConflictMessage,
} from "../venue_account_key.js";
import { _jsonb, getPgPool } from "./common.js";

const PLAYER_SELECT
  = `id, owner_user_id, platform_id, platform_name, player_name, provider, venue_member_id, venue_account_key,
     credit, total_balance, account_data, created_at, updated_at, deleted_at, delete_description`;

function _mapPlayerRow(row) {
  if (!row)
    return null;
  let accountData = {};
  if (row.account_data != null) {
    if (typeof row.account_data === "object" && !Array.isArray(row.account_data)) {
      accountData = row.account_data;
    }
    else {
      try {
        accountData = JSON.parse(String(row.account_data || "{}"));
      }
      catch {
        accountData = {};
      }
    }
  }
  return {
    id: Number(row.id),
    playerId: Number(row.id),
    ownerUserId: row.owner_user_id != null ? String(row.owner_user_id) : null,
    platformId: Number(row.platform_id),
    platformName: String(row.platform_name || ""),
    playerName: String(row.player_name || ""),
    provider: String(row.provider || ""),
    venueMemberId: String(row.venue_member_id || ""),
    venueAccountKey: String(row.venue_account_key || ""),
    credit: Number(row.credit) || 0,
    totalBalance: Number(row.total_balance) || 0,
    accountData,
    createdAt: Number(row.created_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
    deletedAt: row.deleted_at != null ? Number(row.deleted_at) : null,
    deleteDescription: String(row.delete_description || ""),
  };
}

export async function fetchTagPlatforms() {
  const pool = getPgPool();
  if (!pool)
    return [];
  try {
    const { rows } = await pool.query("SELECT id, name FROM tag_platforms ORDER BY id ASC");
    return rows || [];
  }
  catch (err) {
    console.warn("[rds] fetchTagPlatforms:", err.message);
    return [];
  }
}

export async function upsertTagPlatformByName(name) {
  const label = String(name || "").trim();
  if (!label)
    return null;
  const pool = getPgPool();
  if (!pool)
    return null;
  const now = Date.now();
  try {
    const { rows } = await pool.query(
      `INSERT INTO tag_platforms (name, created_at, updated_at)
       VALUES ($1, $2, $2)
       ON CONFLICT (name) DO UPDATE SET updated_at = EXCLUDED.updated_at
       RETURNING id, name`,
      [label, now],
    );
    return rows?.[0] ?? null;
  }
  catch (err) {
    console.warn("[rds] upsertTagPlatformByName:", err.message);
    return null;
  }
}

export async function insertPlayerRow({
  platformId,
  platformName,
  playerName,
  ownerUserId,
  provider = "",
  venueMemberId = "",
}) {
  const pool = getPgPool();
  if (!pool)
    return null;
  const now = Date.now();
  const pid = Number(platformId);
  const uid = String(ownerUserId || "").trim();
  const venueKey = buildVenueAccountKey({ provider, venueMemberId });
  if (!Number.isFinite(pid) || pid <= 0 || !uid)
    return null;
  if (venueKey) {
    let conflict;
    try {
      conflict = await findVenueAccountKeyConflictStrict(venueKey);
    }
    catch (err) {
      console.error("[rds] insertPlayerRow 占用检查失败，已中止:", err?.message);
      throw new Error("场馆账号占用检查失败，请稍后重试（已阻止添加）");
    }
    if (conflict) {
      const sameOwner = conflict.ownerUserId && conflict.ownerUserId === uid;
      if (sameOwner && conflict.deleted)
        throw new VenueAccountKeyConflictError(ownSoftDeletedVenueAccountMessage(conflict), conflict);
      throw new VenueAccountKeyConflictError(venueAccountKeyConflictMessage(conflict), conflict);
    }
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO players (
         owner_user_id, platform_id, platform_name, player_name, provider, venue_member_id,
         venue_account_key, credit, total_balance, account_data, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 0, '{}'::jsonb, $8, $8)
       RETURNING ${PLAYER_SELECT}`,
      [
        uid,
        pid,
        String(platformName || ""),
        String(playerName || ""),
        String(provider || ""),
        String(venueMemberId || ""),
        String(venueKey || ""),
        now,
      ],
    );
    return _mapPlayerRow(rows?.[0]);
  }
  catch (err) {
    if (isVenueAccountKeyUniqueViolation(err))
      throw new VenueAccountKeyConflictError("该场馆操盘账号已被其他用户使用");
    console.warn("[rds] insertPlayerRow:", err.message);
    return null;
  }
}

export async function fetchPlayerByProviderAndVenueMemberId(
  provider,
  venueMemberId,
  ownerUserId,
  { includeDeleted = false } = {},
) {
  const prov = String(provider || "").trim();
  const memberId = String(venueMemberId || "").trim();
  const uid = String(ownerUserId || "").trim();
  if (!prov || !memberId || !uid)
    return null;
  const pool = getPgPool();
  if (!pool)
    return null;
  try {
    const deletedClause = includeDeleted ? "" : " AND deleted_at IS NULL";
    const { rows } = await pool.query(
      `SELECT ${PLAYER_SELECT}
       FROM players
       WHERE provider = $1 AND venue_member_id = $2 AND owner_user_id = $3::uuid${deletedClause}
       ORDER BY (deleted_at IS NULL) DESC, id ASC
       LIMIT 1`,
      [prov, memberId, uid],
    );
    return _mapPlayerRow(rows?.[0]);
  }
  catch (err) {
    console.warn("[rds] fetchPlayerByProviderAndVenueMemberId:", err.message);
    return null;
  }
}

/**
 * 全库场馆账号互斥（含软删）：查找占用同一 venue_account_key 的其他 player。
 * strict：查询失败向上抛（供 CreateTagPlatform / SaveData 等写路径 fail-closed）。
 * 无 key / 无 pool → `null`（非失败）；无占用行 → `null`。
 */
export async function findVenueAccountKeyConflictStrict(venueAccountKey, { playerId } = {}) {
  const key = String(venueAccountKey || "").trim();
  if (!key)
    return null;
  const pool = getPgPool();
  if (!pool)
    return null;
  const id = Number(playerId) || 0;
  const { rows } = await pool.query(
    `SELECT p.id, p.owner_user_id, p.deleted_at, u.user_name
     FROM players p
     LEFT JOIN users u ON u.id = p.owner_user_id
     WHERE p.venue_account_key = $1
       AND ($2::bigint = 0 OR p.id <> $2)
     ORDER BY (p.deleted_at IS NULL) DESC, p.updated_at DESC NULLS LAST, p.id DESC
     LIMIT 1`,
    [key, id],
  );
  const row = rows?.[0];
  if (!row)
    return null;
  return {
    id: Number(row.id),
    ownerUserId: row.owner_user_id != null ? String(row.owner_user_id) : null,
    userName: String(row.user_name || ""),
    deletedAt: row.deleted_at != null ? Number(row.deleted_at) : null,
    deleted: row.deleted_at != null,
  };
}

/**
 * 全库场馆账号互斥（含软删）：查找占用同一 venue_account_key 的其他 player。
 * 软删行仍占坑，防止删号后被他人抢加。
 * lenient：失败吞成 `null`（仅展示/非写路径）。
 */
export async function findVenueAccountKeyConflict(venueAccountKey, { playerId } = {}) {
  try {
    return await findVenueAccountKeyConflictStrict(venueAccountKey, { playerId });
  }
  catch (err) {
    console.warn("[rds] findVenueAccountKeyConflict:", err.message);
    return null;
  }
}

/**
 * 按 venue_account_key 取占用人（含软删；优先活跃）。
 * strict：查询失败向上抛。
 */
export async function fetchPlayerByVenueAccountKeyStrict(venueAccountKey) {
  const key = String(venueAccountKey || "").trim();
  if (!key)
    return null;
  const pool = getPgPool();
  if (!pool)
    return null;
  const { rows } = await pool.query(
    `SELECT ${PLAYER_SELECT}
     FROM players
     WHERE venue_account_key = $1
     ORDER BY (deleted_at IS NULL) DESC, updated_at DESC NULLS LAST, id DESC
     LIMIT 1`,
    [key],
  );
  return _mapPlayerRow(rows?.[0]);
}

/** 按 venue_account_key 取占用人（含软删；优先活跃）；lenient 失败→null */
export async function fetchPlayerByVenueAccountKey(venueAccountKey) {
  try {
    return await fetchPlayerByVenueAccountKeyStrict(venueAccountKey);
  }
  catch (err) {
    console.warn("[rds] fetchPlayerByVenueAccountKey:", err.message);
    return null;
  }
}

/**
 * 本人软删账号复活：清 deleted_at，刷新展示字段与 venue_account_key。
 * 供 CreateTagPlatform「添加账号」路径复用同一 playerId。
 */
export async function resurrectPlayerRow(playerId, ownerUserId, {
  platformId,
  platformName,
  playerName,
  provider = "",
  venueMemberId = "",
} = {}) {
  const id = Number(playerId);
  const uid = String(ownerUserId || "").trim();
  if (!Number.isFinite(id) || id <= 0 || !uid)
    return null;
  const pool = getPgPool();
  if (!pool)
    return null;
  const now = Date.now();
  const prov = String(provider || "").trim();
  const memberId = String(venueMemberId || "").trim();
  const venueKey = buildVenueAccountKey({ provider: prov, venueMemberId: memberId });
  const pid = Number(platformId);
  try {
    const params = [
      id,
      uid,
      String(platformName || ""),
      String(playerName || ""),
      prov,
      memberId,
      String(venueKey || ""),
      now,
    ];
    let platformClause = "";
    if (Number.isFinite(pid) && pid > 0) {
      params.push(pid);
      platformClause = `, platform_id = $${params.length}`;
    }
    const { rows } = await pool.query(
      `UPDATE players SET
         deleted_at = NULL,
         delete_description = '',
         platform_name = $3,
         player_name = $4,
         provider = CASE WHEN $5 <> '' THEN $5 ELSE provider END,
         venue_member_id = CASE WHEN $6 <> '' THEN $6 ELSE venue_member_id END,
         venue_account_key = CASE
           WHEN $7 <> '' THEN $7
           ELSE venue_account_key
         END,
         updated_at = $8${platformClause}
       WHERE id = $1
         AND owner_user_id = $2::uuid
         AND deleted_at IS NOT NULL
       RETURNING ${PLAYER_SELECT}`,
      params,
    );
    return _mapPlayerRow(rows?.[0]);
  }
  catch (err) {
    if (isVenueAccountKeyUniqueViolation(err))
      throw new VenueAccountKeyConflictError("该场馆操盘账号已被其他用户使用");
    console.warn("[rds] resurrectPlayerRow:", err.message);
    return null;
  }
}

export async function fetchPlayerByPlatformAndName(
  platformId,
  playerName,
  ownerUserId,
  { includeDeleted = false } = {},
) {
  const pid = Number(platformId);
  const name = String(playerName || "").trim();
  const uid = String(ownerUserId || "").trim();
  if (!Number.isFinite(pid) || pid <= 0 || !name || !uid)
    return null;
  const pool = getPgPool();
  if (!pool)
    return null;
  try {
    const deletedClause = includeDeleted ? "" : " AND deleted_at IS NULL";
    const { rows } = await pool.query(
      `SELECT ${PLAYER_SELECT}
       FROM players
       WHERE platform_id = $1 AND player_name = $2 AND owner_user_id = $3::uuid${deletedClause}
       ORDER BY (deleted_at IS NULL) DESC, id ASC
       LIMIT 1`,
      [pid, name, uid],
    );
    return _mapPlayerRow(rows?.[0]);
  }
  catch (err) {
    console.warn("[rds] fetchPlayerByPlatformAndName:", err.message);
    return null;
  }
}

/** CreateTagPlatform 回退：历史数据 platform_id 可能与 tag_platforms 不一致 */
export async function fetchPlayerByPlatformNameAndPlayerName(
  platformName,
  playerName,
  ownerUserId,
  { includeDeleted = false } = {},
) {
  const label = String(platformName || "").trim();
  const name = String(playerName || "").trim();
  const uid = String(ownerUserId || "").trim();
  if (!label || !name || !uid)
    return null;
  const pool = getPgPool();
  if (!pool)
    return null;
  try {
    const deletedClause = includeDeleted ? "" : " AND deleted_at IS NULL";
    const { rows } = await pool.query(
      `SELECT ${PLAYER_SELECT}
       FROM players
       WHERE platform_name = $1 AND player_name = $2 AND owner_user_id = $3::uuid${deletedClause}
       ORDER BY (deleted_at IS NULL) DESC, id ASC
       LIMIT 1`,
      [label, name, uid],
    );
    return _mapPlayerRow(rows?.[0]);
  }
  catch (err) {
    console.warn("[rds] fetchPlayerByPlatformNameAndPlayerName:", err.message);
    return null;
  }
}

export async function fetchPlayerById(playerId) {
  const id = Number(playerId);
  if (!Number.isFinite(id) || id <= 0)
    return null;
  const pool = getPgPool();
  if (!pool)
    return null;
  try {
    const { rows } = await pool.query(
      `SELECT ${PLAYER_SELECT}
       FROM players WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return _mapPlayerRow(rows?.[0]);
  }
  catch (err) {
    console.warn("[rds] fetchPlayerById:", err.message);
    return null;
  }
}

/** 批量读 players（归属校验、SaveData ACCOUNT） */
export async function fetchPlayersByIds(playerIds) {
  const ids = [...new Set((playerIds || []).map(id => Number(id)).filter(id => id > 0))];
  if (!ids.length)
    return [];
  const pool = getPgPool();
  if (!pool)
    return [];
  try {
    const { rows } = await pool.query(
      `SELECT ${PLAYER_SELECT}
       FROM players WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL`,
      [ids],
    );
    return (rows || []).map(r => _mapPlayerRow(r)).filter(Boolean);
  }
  catch (err) {
    console.warn("[rds] fetchPlayersByIds:", err.message);
    return [];
  }
}

/**
 * 批量读 players（含已 soft-delete）。
 * 工作台 / 管理端历史订单展示原账号名；勿用于归属校验 / SaveData。
 */
export async function fetchPlayersByIdsIncludingDeleted(playerIds) {
  const ids = [...new Set((playerIds || []).map(id => Number(id)).filter(id => id > 0))];
  if (!ids.length)
    return [];
  const pool = getPgPool();
  if (!pool)
    return [];
  try {
    const { rows } = await pool.query(
      `SELECT ${PLAYER_SELECT}
       FROM players WHERE id = ANY($1::bigint[])`,
      [ids],
    );
    return (rows || []).map(r => _mapPlayerRow(r)).filter(Boolean);
  }
  catch (err) {
    console.warn("[rds] fetchPlayersByIdsIncludingDeleted:", err.message);
    return [];
  }
}

export async function insertUserLogRow(userId, title, data) {
  const uid = String(userId || "").trim();
  if (!uid)
    return false;
  const pool = getPgPool();
  if (!pool)
    return false;
  const now = Date.now();
  try {
    await pool.query(
      `INSERT INTO user_logs (user_id, title, data, create_at)
       VALUES ($1, $2, $3, $4)`,
      [uid, String(title || ""), String(data ?? ""), now],
    );
    return true;
  }
  catch (err) {
    console.warn("[rds] insertUserLogRow:", err.message);
    return false;
  }
}

/** 运维：按用户 + 时间窗读取 Client_SaveUserLog 诊断日志 */
export async function fetchUserLogsInRange(userId, fromMs, toMs, limit = 200) {
  const uid = String(userId || "").trim();
  if (!uid)
    return [];
  const pool = getPgPool();
  if (!pool)
    return [];
  const from = Number(fromMs) || 0;
  const to = Number(toMs) || Date.now();
  const cap = Math.min(Math.max(Number(limit) || 200, 1), 500);
  try {
    const { rows } = await pool.query(
      `SELECT id, user_id, title, data, create_at
       FROM user_logs
       WHERE user_id = $1 AND create_at >= $2 AND create_at <= $3
       ORDER BY create_at ASC
       LIMIT $4`,
      [uid, from, to, cap],
    );
    return rows || [];
  }
  catch (err) {
    console.warn("[rds] fetchUserLogsInRange:", err.message);
    return [];
  }
}

/**
 * 管理端下单诊断专用查询。
 *
 * 必须先在 SQL 层排除赛事/盘口采集噪声，再做数量限制；否则高频采集日志会
 * 占满 LIMIT，导致同一 Link 后半段的补单、下注和终态日志永远无法进入诊断。
 */
export async function fetchBettingUserLogsInRange(userId, fromMs, toMs, limit = 1000, identity = {}) {
  const uid = String(userId || "").trim();
  if (!uid)
    return { rows: [], truncated: false, limit: 0 };
  const pool = getPgPool();
  if (!pool)
    throw new Error("诊断日志数据库不可用，请稍后重试");
  const from = Number(fromMs) || 0;
  const to = Number(toMs) || Date.now();
  const cap = Math.floor(Math.min(Math.max(Number(limit) || 1000, 1), 5000));
  // [changmen 扩展] data 是历史 text 字段，避免 JSON 强转被旧日志破坏。
  // 明确标识的日志跨时间窗查询，并优先进入 LIMIT；旧日志仍按时间窗兜底。
  const escapeRegex = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [];
  const link = Number(identity.link);
  if (Number.isFinite(link) && link !== 0)
    patterns.push(`"(linkId|link)"[[:space:]]*:[[:space:]]*"?${link}"?[[:space:]]*[,}]`);
  for (const id of identity.orderIds || []) {
    if (String(id).trim()) {
      patterns.push(`"orderId"[[:space:]]*:[[:space:]]*${escapeRegex(JSON.stringify(String(id)))}[[:space:]]*[,}]`);
      if (/^\d+$/.test(String(id)))
        patterns.push(`"orderId"[[:space:]]*:[[:space:]]*${id}[[:space:]]*[,}]`);
    }
  }
  const exactPattern = patterns.length ? patterns.map(pattern => `(${pattern})`).join("|") : null;
  try {
    const result = await pool.query(
      `SELECT id, user_id, title, data, create_at
       FROM user_logs
       WHERE user_id = $1
         AND ((create_at >= $2 AND create_at <= $3) OR ($5::text IS NOT NULL AND data ~ $5))
         AND (
           title LIKE '%请求盘口数据%'
           OR title LIKE '%下注 =>%'
           OR title LIKE '%拒单%'
           OR title LIKE '%补单入队%'
           OR title LIKE '%补单取消%'
          )
       ORDER BY CASE WHEN $5::text IS NOT NULL AND data ~ $5 THEN 0 ELSE 1 END, create_at ASC, id ASC
       LIMIT $4`,
      [uid, from, to, cap + 1, exactPattern],
    );
    const all = result.rows || [];
    return {
      rows: all.slice(0, cap).sort((a, b) => Number(a.create_at) - Number(b.create_at) || Number(a.id) - Number(b.id)),
      truncated: all.length > cap,
      limit: cap,
    };
  }
  catch (err) {
    console.warn("[rds] fetchBettingUserLogsInRange:", err.message);
    throw new Error("诊断日志查询失败，请稍后重试", { cause: err });
  }
}

/** 仅更新 players.platform_name（账号显示名；不改 platform_id） */
export async function updatePlayerDisplayName(playerId, platformName, ownerUserId) {
  const count = await batchUpdatePlayerDisplayNames(ownerUserId, [{ playerId, platformName }]);
  return count > 0;
}

/** SaveData ACCOUNT：批量更新 platform_name（跳过未变化项由调用方负责） */
export async function batchUpdatePlayerDisplayNames(ownerUserId, updates) {
  const uid = String(ownerUserId || "").trim();
  const rows = (updates || [])
    .map(u => ({
      playerId: Number(u?.playerId),
      platformName: String(u?.platformName || "").trim(),
    }))
    .filter(u => Number.isFinite(u.playerId) && u.playerId > 0 && u.platformName);
  if (!uid || !rows.length)
    return 0;
  const pool = getPgPool();
  if (!pool)
    return 0;
  const now = Date.now();
  try {
    const { rowCount } = await pool.query(
      `UPDATE players AS p SET
         platform_name = v.label,
         updated_at = $3
       FROM unnest($1::bigint[], $2::text[]) AS v(id, label)
       WHERE p.id = v.id
         AND p.owner_user_id = $4::uuid
         AND p.deleted_at IS NULL`,
      [rows.map(r => r.playerId), rows.map(r => r.platformName), now, uid],
    );
    return rowCount ?? 0;
  }
  catch (err) {
    console.warn("[rds] batchUpdatePlayerDisplayNames:", err.message);
    return 0;
  }
}

export async function updatePlayerBalanceRow(playerId, balance, ownerUserId) {
  const id = Number(playerId);
  if (!Number.isFinite(id) || id <= 0)
    return null;
  const pool = getPgPool();
  if (!pool)
    return null;
  const now = Date.now();
  const total = Number(balance) || 0;
  const uid = ownerUserId != null ? String(ownerUserId).trim() : "";
  try {
    const params = uid ? [id, total, now, uid] : [id, total, now];
    const ownerClause = uid ? " AND owner_user_id = $4::uuid" : "";
    const { rows } = await pool.query(
      `UPDATE players SET total_balance = $2, updated_at = $3
       WHERE id = $1 AND deleted_at IS NULL${ownerClause}
       RETURNING ${PLAYER_SELECT}`,
      params,
    );
    const row = _mapPlayerRow(rows?.[0]);
    if (!row)
      return null;
    return {
      total: row.totalBalance,
      platformId: row.platformId,
      platformName: row.platformName,
    };
  }
  catch (err) {
    console.warn("[rds] updatePlayerBalanceRow:", err.message);
    return null;
  }
}

/**
 * 条件扣减：仅当 total_balance >= amount 时扣减，防止并发超扣。
 * @returns {{ total, platformId, platformName } | null} 不足或失败返回 null
 */
export async function debitPlayerBalanceRow(playerId, amount, ownerUserId) {
  const id = Number(playerId);
  const debit = Math.round((Number(amount) || 0) * 100) / 100;
  if (!Number.isFinite(id) || id <= 0 || !(debit > 0))
    return null;
  const pool = getPgPool();
  if (!pool)
    return null;
  const now = Date.now();
  const uid = ownerUserId != null ? String(ownerUserId).trim() : "";
  try {
    const params = uid ? [id, debit, now, uid] : [id, debit, now];
    const ownerClause = uid ? " AND owner_user_id = $4::uuid" : "";
    const { rows } = await pool.query(
      `UPDATE players
       SET total_balance = total_balance - $2, updated_at = $3
       WHERE id = $1 AND deleted_at IS NULL${ownerClause}
         AND total_balance >= $2
       RETURNING ${PLAYER_SELECT}`,
      params,
    );
    const row = _mapPlayerRow(rows?.[0]);
    if (!row)
      return null;
    return {
      total: row.totalBalance,
      platformId: row.platformId,
      platformName: row.platformName,
    };
  }
  catch (err) {
    console.warn("[rds] debitPlayerBalanceRow:", err.message);
    return null;
  }
}

/**
 * 条件入账：total_balance += amount（amount>0）。
 * @returns {{ total, platformId, platformName } | null}
 */
export async function creditPlayerBalanceRow(playerId, amount, ownerUserId) {
  const id = Number(playerId);
  const credit = Math.round((Number(amount) || 0) * 100) / 100;
  if (!Number.isFinite(id) || id <= 0 || !(credit > 0))
    return null;
  const pool = getPgPool();
  if (!pool)
    return null;
  const now = Date.now();
  const uid = ownerUserId != null ? String(ownerUserId).trim() : "";
  try {
    const params = uid ? [id, credit, now, uid] : [id, credit, now];
    const ownerClause = uid ? " AND owner_user_id = $4::uuid" : "";
    const { rows } = await pool.query(
      `UPDATE players
       SET total_balance = total_balance + $2, updated_at = $3
       WHERE id = $1 AND deleted_at IS NULL${ownerClause}
       RETURNING ${PLAYER_SELECT}`,
      params,
    );
    const row = _mapPlayerRow(rows?.[0]);
    if (!row)
      return null;
    return {
      total: row.totalBalance,
      platformId: row.platformId,
      platformName: row.platformName,
    };
  }
  catch (err) {
    console.warn("[rds] creditPlayerBalanceRow:", err.message);
    return null;
  }
}

/**
 * PF 管理端充值：同一事务内 total_balance += amount + 写入 money_logs。
 * 任一步失败整笔回滚。
 *
 * @param {{
 *   playerId: number,
 *   ownerUserId: string,
 *   amount: number,
 *   description?: string,
 *   currency?: string,
 *   maxBalance?: number,
 * }} opts
 * @returns {Promise<{
 *   ok: true,
 *   balanceBefore: number,
 *   total: number,
 *   amount: number,
 *   log: Record<string, unknown>,
 * } | { ok: false, msg: string }>}
 */
export async function rechargePlayerBalanceWithMoneyLogRow(opts = {}) {
  const playerId = Number(opts.playerId);
  const ownerUserId = String(opts.ownerUserId || "").trim();
  const amount = Math.round((Number(opts.amount) || 0) * 100) / 100;
  const description = String(opts.description || "");
  const currency = String(opts.currency || "USDT");
  const maxBalance = Math.round((Number(opts.maxBalance) || 0) * 100) / 100;

  if (!Number.isFinite(playerId) || playerId <= 0 || !ownerUserId)
    return { ok: false, msg: "参数无效" };
  if (!(amount > 0))
    return { ok: false, msg: "充值金额必须大于 0" };

  const pool = getPgPool();
  if (!pool)
    return { ok: false, msg: "数据库未就绪" };

  const client = await pool.connect();
  const now = Date.now();
  try {
    await client.query("BEGIN");
    const sel = await client.query(
      `SELECT ${PLAYER_SELECT}
       FROM players
       WHERE id = $1 AND deleted_at IS NULL AND owner_user_id = $2::uuid
       FOR UPDATE`,
      [playerId, ownerUserId],
    );
    const player = _mapPlayerRow(sel.rows?.[0]);
    if (!player) {
      await client.query("ROLLBACK");
      return { ok: false, msg: "会员归属不匹配" };
    }

    const balanceBefore = Math.round((Number(player.totalBalance) || 0) * 100) / 100;
    if (maxBalance > 0 && balanceBefore + amount > maxBalance) {
      await client.query("ROLLBACK");
      return {
        ok: false,
        msg: `充值后将超过上限 ${maxBalance} USDT（当前 ${balanceBefore}）`,
      };
    }

    const upd = await client.query(
      `UPDATE players
       SET total_balance = total_balance + $2, updated_at = $3
       WHERE id = $1 AND deleted_at IS NULL AND owner_user_id = $4::uuid
       RETURNING ${PLAYER_SELECT}`,
      [playerId, amount, now, ownerUserId],
    );
    const after = _mapPlayerRow(upd.rows?.[0]);
    if (!after) {
      await client.query("ROLLBACK");
      return { ok: false, msg: "入账失败" };
    }

    const logRes = await client.query(
      `INSERT INTO money_logs (user_id, player_id, type, money, currency, description, is_auto, create_at, updated_at)
       VALUES ($1::uuid, $2, 'Recharge', $3, $4, $5, 0, $6, $6)
       RETURNING *`,
      [ownerUserId, playerId, amount, currency, description, now],
    );
    const log = logRes.rows?.[0];
    if (!log) {
      await client.query("ROLLBACK");
      return { ok: false, msg: "充值流水写入失败" };
    }

    await client.query("COMMIT");
    return {
      ok: true,
      balanceBefore,
      total: after.totalBalance,
      amount,
      log,
    };
  }
  catch (err) {
    try {
      await client.query("ROLLBACK");
    }
    catch {
      /* ignore */
    }
    console.warn("[rds] rechargePlayerBalanceWithMoneyLogRow:", err.message);
    return { ok: false, msg: err.message || "充值事务失败" };
  }
  finally {
    client.release();
  }
}

export async function softDeletePlayerRow(playerId, description, ownerUserId) {
  const id = Number(playerId);
  if (!Number.isFinite(id) || id <= 0)
    return false;
  const pool = getPgPool();
  if (!pool)
    return false;
  const now = Date.now();
  const uid = ownerUserId != null ? String(ownerUserId).trim() : "";
  try {
    const params = uid ? [id, now, String(description || ""), uid] : [id, now, String(description || "")];
    const ownerClause = uid ? " AND owner_user_id = $4::uuid" : "";
    const res = await pool.query(
      `UPDATE players
       SET deleted_at = $2, delete_description = $3, updated_at = $2
       WHERE id = $1 AND deleted_at IS NULL${ownerClause}`,
      params,
    );
    return (res.rowCount ?? 0) > 0;
  }
  catch (err) {
    console.warn("[rds] softDeletePlayerRow:", err.message);
    return false;
  }
}

export async function softDeletePlayersNotInList(ownerUserId, keepPlayerIds, description = "pruned: not in ACCOUNT list") {
  const uid = String(ownerUserId || "").trim();
  const keep = [...new Set((keepPlayerIds || []).map(id => Number(id)).filter(id => id > 0))];
  if (!uid || !keep.length)
    return 0;
  const pool = getPgPool();
  if (!pool)
    return 0;
  const now = Date.now();
  try {
    const { rowCount } = await pool.query(
      `UPDATE players
       SET deleted_at = $1, delete_description = $2, updated_at = $1
       WHERE owner_user_id = $3::uuid
         AND deleted_at IS NULL
         AND NOT (id = ANY($4::bigint[]))`,
      [now, String(description || ""), uid, keep],
    );
    return rowCount ?? 0;
  }
  catch (err) {
    console.warn("[rds] softDeletePlayersNotInList:", err.message);
    return 0;
  }
}

/** Polymarket 账号：user_name + account_data（Builder 看板 maker/owner 反查） */
export async function fetchPolymarketPlayersForTradeLookup() {
  const pool = getPgPool();
  if (!pool)
    return [];
  try {
    const { rows } = await pool.query(
      `SELECT pr.user_name, p.venue_member_id, p.account_data
       FROM players p
       JOIN profiles pr ON pr.id = p.owner_user_id
       WHERE LOWER(p.provider) = 'polymarket' AND p.deleted_at IS NULL
       ORDER BY pr.user_name ASC, p.id ASC`,
    );
    return rows || [];
  }
  catch (err) {
    console.warn("[rds] fetchPolymarketPlayersForTradeLookup:", err.message);
    return [];
  }
}

/**
 * strict 版：用户全部活跃账号 → A8 AccountRecord[]。
 * 查询失败 **向上抛**（供"读驱动写/删"的敏感路径中止操作，勿把失败当"无账号"）。
 * 无 uid / 无 pool（未接 RDS）→ 返回 `[]`（正常语义，非失败）；真正无行 → `[]`。
 */
export async function fetchAccountRecordsByOwnerStrict(ownerUserId) {
  const uid = String(ownerUserId || "").trim();
  if (!uid)
    return [];
  const pool = getPgPool();
  if (!pool)
    return [];
  const { rows } = await pool.query(
    `SELECT ${PLAYER_SELECT}
     FROM players
     WHERE owner_user_id = $1::uuid AND deleted_at IS NULL
     ORDER BY id ASC`,
    [uid],
  );
  return (rows || []).map(r => playerRowToAccountRecord(_mapPlayerRow(r))).filter(Boolean);
}

/** 用户全部活跃账号 → A8 AccountRecord[]（lenient：失败吞成 `[]`，仅展示/刷新用） */
export async function fetchAccountRecordsByOwner(ownerUserId) {
  try {
    return await fetchAccountRecordsByOwnerStrict(ownerUserId);
  }
  catch (err) {
    console.warn("[rds] fetchAccountRecordsByOwner:", err.message);
    return [];
  }
}

/**
 * 用户软删账号（管理端展示用）。
 * 附带 deletedAt / deleted / deleteDescription，不进内存 ACCOUNT 缓存。
 */
export async function fetchDeletedAccountRecordsByOwner(ownerUserId) {
  const uid = String(ownerUserId || "").trim();
  if (!uid)
    return [];
  const pool = getPgPool();
  if (!pool)
    return [];
  try {
    const { rows } = await pool.query(
      `SELECT ${PLAYER_SELECT}
       FROM players
       WHERE owner_user_id = $1::uuid AND deleted_at IS NOT NULL
       ORDER BY deleted_at DESC, id ASC`,
      [uid],
    );
    return (rows || []).map((r) => {
      const mapped = _mapPlayerRow(r);
      const rec = playerRowToAccountRecord(mapped);
      if (!rec)
        return null;
      rec.deletedAt = mapped.deletedAt;
      rec.deleted = true;
      rec.active = false;
      if (mapped.deleteDescription)
        rec.description = mapped.deleteDescription;
      else if (!rec.description)
        rec.description = "已删除";
      return rec;
    }).filter(Boolean);
  }
  catch (err) {
    console.warn("[rds] fetchDeletedAccountRecordsByOwner:", err.message);
    return [];
  }
}

export async function countActivePlayersByOwner(ownerUserId) {
  const uid = String(ownerUserId || "").trim();
  if (!uid)
    return 0;
  const pool = getPgPool();
  if (!pool)
    return 0;
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM players
       WHERE owner_user_id = $1::uuid AND deleted_at IS NULL`,
      [uid],
    );
    return Number(rows?.[0]?.c) || 0;
  }
  catch (err) {
    console.warn("[rds] countActivePlayersByOwner:", err.message);
    return 0;
  }
}

/** 单条账号 upsert 到 players（SaveData ACCOUNT / 余额刷新） */
export async function savePlayerAccountRecord(ownerUserId, record) {
  const uid = String(ownerUserId || "").trim();
  const patch = accountRecordToPlayerPatch(record);
  const id = Number(patch.playerId);
  if (!uid || !Number.isFinite(id) || id <= 0)
    return false;
  const pool = getPgPool();
  if (!pool)
    return false;
  const now = Number(patch.updatedAt) || Date.now();
  const platformId = patch.platformId;
  try {
    const params = [
      id,
      uid,
      patch.platformName,
      patch.playerName,
      patch.provider,
      String(patch.venueMemberId || ""),
      String(patch.venueAccountKey || ""),
      patch.credit,
      patch.totalBalance,
      _jsonb(patch.accountData, {}),
      now,
    ];
    let platformClause = "";
    if (platformId != null && Number.isFinite(platformId) && platformId > 0) {
      params.push(platformId);
      platformClause = `, platform_id = $${params.length}`;
    }
    // PredictFun：仅当库内 provider 已是 PF 时保护账本（勿用入参 provider，否则伪造可清 OB credit）；
    // 若历史误写在 credit 且 total_balance=0，顺带迁入（对齐 resolvePfBalance）。
    const { rowCount } = await pool.query(
      `UPDATE players SET
         platform_name = $3,
         player_name = $4,
         provider = CASE
           WHEN lower(provider) = 'predictfun' THEN provider
           ELSE $5
         END,
         venue_member_id = $6,
         venue_account_key = $7,
         total_balance = CASE
           WHEN lower(provider) = 'predictfun' THEN
             CASE
               WHEN coalesce(total_balance, 0) = 0 AND coalesce(credit, 0) > 0 THEN credit
               ELSE total_balance
             END
           ELSE $9
         END,
         credit = CASE
           WHEN lower(provider) = 'predictfun' THEN 0
           ELSE $8
         END,
         account_data = $10::jsonb,
         updated_at = $11${platformClause}
       WHERE id = $1 AND owner_user_id = $2::uuid AND deleted_at IS NULL`,
      params,
    );
    return (rowCount ?? 0) > 0;
  }
  catch (err) {
    if (isVenueAccountKeyUniqueViolation(err))
      throw new VenueAccountKeyConflictError("该场馆操盘账号已被其他用户使用");
    console.warn("[rds] savePlayerAccountRecord:", err.message);
    return false;
  }
}

/** SaveData ACCOUNT：落库并抛出场馆账号冲突 */
export async function saveAccountRecordsForOwner(ownerUserId, records) {
  const uid = String(ownerUserId || "").trim();
  if (!uid || !Array.isArray(records) || !records.length)
    return 0;
  return batchSavePlayerAccountRecords(uid, records);
}

/** 批量 UPDATE players（SaveData ACCOUNT 落库） */
export async function batchSavePlayerAccountRecords(ownerUserId, records) {
  const uid = String(ownerUserId || "").trim();
  if (!uid || !Array.isArray(records) || !records.length)
    return 0;
  const patches = records
    .map(r => accountRecordToPlayerPatch(r))
    .filter(p => Number.isFinite(p.playerId) && p.playerId > 0);
  if (!patches.length)
    return 0;
  const pool = getPgPool();
  if (!pool)
    return 0;
  const now = Date.now();
  const ids = [];
  const platformNames = [];
  const playerNames = [];
  const providers = [];
  const venueMemberIds = [];
  const venueAccountKeys = [];
  const credits = [];
  const totalBalances = [];
  const accountDatas = [];
  const updatedAts = [];
  const platformIds = [];
  for (const patch of patches) {
    ids.push(Number(patch.playerId));
    platformNames.push(String(patch.platformName || ""));
    playerNames.push(String(patch.playerName || ""));
    providers.push(String(patch.provider || ""));
    venueMemberIds.push(String(patch.venueMemberId || ""));
    venueAccountKeys.push(String(patch.venueAccountKey || ""));
    credits.push(Number(patch.credit) || 0);
    totalBalances.push(Number(patch.totalBalance) || 0);
    accountDatas.push(JSON.parse(_jsonb(patch.accountData, {})));
    updatedAts.push(Number(patch.updatedAt) || now);
    platformIds.push(
      patch.platformId != null && Number.isFinite(Number(patch.platformId)) && Number(patch.platformId) > 0
        ? Number(patch.platformId)
        : null,
    );
  }
  for (const patch of patches) {
    const key = String(patch.venueAccountKey || "").trim();
    if (!key)
      continue;
    let conflict;
    try {
      conflict = await findVenueAccountKeyConflictStrict(key, { playerId: patch.playerId });
    }
    catch (err) {
      console.error("[rds] findVenueAccountKeyConflictStrict 失败，已中止 SaveData:", err?.message);
      throw new Error("场馆账号占用检查失败，请稍后重试（已阻止保存）");
    }
    if (!conflict)
      continue;
    const sameOwner = conflict.ownerUserId && conflict.ownerUserId === uid;
    if (sameOwner && conflict.deleted) {
      throw new VenueAccountKeyConflictError(
        ownSoftDeletedVenueAccountMessage(conflict),
        conflict,
      );
    }
    throw new VenueAccountKeyConflictError(venueAccountKeyConflictMessage(conflict), conflict);
  }
  try {
    // PredictFun：只认库内 p.provider（勿 OR u.provider，否则伪造 PredictFun 会把 OB credit 清 0）；
    // ACCOUNT 不得绝对 SET total_balance；credit>0 且 total_balance=0 时迁入。
    const { rowCount } = await pool.query(
      `UPDATE players AS p SET
         platform_name = u.platform_name,
         player_name = u.player_name,
         provider = CASE
           WHEN lower(p.provider) = 'predictfun' THEN p.provider
           ELSE u.provider
         END,
         venue_member_id = u.venue_member_id,
         venue_account_key = u.venue_account_key,
         total_balance = CASE
           WHEN lower(p.provider) = 'predictfun' THEN
             CASE
               WHEN coalesce(p.total_balance, 0) = 0 AND coalesce(p.credit, 0) > 0 THEN p.credit
               ELSE p.total_balance
             END
           ELSE u.total_balance
         END,
         credit = CASE
           WHEN lower(p.provider) = 'predictfun' THEN 0
           ELSE u.credit
         END,
         account_data = u.account_data,
         updated_at = u.updated_at,
         platform_id = COALESCE(u.platform_id, p.platform_id)
       FROM unnest(
         $1::bigint[],
         $2::text[],
         $3::text[],
         $4::text[],
         $5::text[],
         $6::text[],
         $7::float8[],
         $8::float8[],
         $9::jsonb[],
         $10::bigint[],
         $11::bigint[]
       ) AS u(
         id, platform_name, player_name, provider, venue_member_id, venue_account_key, credit, total_balance,
         account_data, updated_at, platform_id
       )
       WHERE p.id = u.id
         AND p.owner_user_id = $12::uuid
         AND p.deleted_at IS NULL`,
      [
        ids,
        platformNames,
        playerNames,
        providers,
        venueMemberIds,
        venueAccountKeys,
        credits,
        totalBalances,
        accountDatas,
        updatedAts,
        platformIds,
        uid,
      ],
    );
    return rowCount ?? 0;
  }
  catch (err) {
    if (isVenueAccountKeyUniqueViolation(err))
      throw new VenueAccountKeyConflictError("该场馆操盘账号已被其他用户使用");
    console.warn("[rds] batchSavePlayerAccountRecords:", err.message);
    return 0;
  }
}

/** 部分字段更新（余额刷新 syncAccountRowInKv） */
export async function patchPlayerAccountRecord(ownerUserId, playerId, updates) {
  const uid = String(ownerUserId || "").trim();
  const id = Number(playerId);
  if (!uid || !Number.isFinite(id) || id <= 0)
    return null;
  const existing = await fetchPlayerById(id);
  if (!existing || String(existing.ownerUserId) !== uid)
    return null;
  const merged = playerRowToAccountRecord(existing);
  Object.assign(merged, updates, { accountId: id, updateTime: Date.now() });
  const ok = await savePlayerAccountRecord(uid, merged);
  if (!ok)
    return null;
  const refreshed = await fetchPlayerById(id);
  return playerRowToAccountRecord(refreshed);
}
