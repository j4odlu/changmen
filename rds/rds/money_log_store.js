/**
 * money_logs 表读写。
 */

import { getPgPool } from "./common.js";
import { localMonthBounds } from "./time_bounds.js";

async function _rdsUpsertMoneyLog(pool, row) {
  const now = Date.now();
  const payload = {
    user_id: String(row.user_id),
    player_id: Number(row.player_id),
    type: String(row.type || "Recharge"),
    money: Number(row.money) || 0,
    currency: String(row.currency || "CNY"),
    description: String(row.description || ""),
    is_auto: Number(row.is_auto) ? 1 : 0,
    create_at: Number(row.create_at) || now,
    updated_at: Number(row.updated_at) || now,
  };
  const id = Number(row.id) || 0;
  if (id > 0) {
    const { rows } = await pool.query(
      `INSERT INTO money_logs (id, user_id, player_id, type, money, currency, description, is_auto, create_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO UPDATE SET
         type = EXCLUDED.type,
         money = EXCLUDED.money,
         currency = EXCLUDED.currency,
         description = EXCLUDED.description,
         is_auto = EXCLUDED.is_auto,
         create_at = EXCLUDED.create_at,
         updated_at = EXCLUDED.updated_at
       RETURNING *`,
      [
        id,
        payload.user_id,
        payload.player_id,
        payload.type,
        payload.money,
        payload.currency,
        payload.description,
        payload.is_auto,
        payload.create_at,
        payload.updated_at,
      ],
    );
    return rows?.[0] ?? null;
  }
  const { rows } = await pool.query(
    `INSERT INTO money_logs (user_id, player_id, type, money, currency, description, is_auto, create_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [
      payload.user_id,
      payload.player_id,
      payload.type,
      payload.money,
      payload.currency,
      payload.description,
      payload.is_auto,
      payload.create_at,
      payload.updated_at,
    ],
  );
  return rows?.[0] ?? null;
}

/** 月报：读取指定月份充提/被黑流水；可选 user_id 筛选 */
export async function fetchMoneyLogsForMonthAggregate(monthKey, userId, userIds) {
  const { monthStart, monthEnd } = localMonthBounds(monthKey);
  const pool = getPgPool();
  if (!pool)
    return [];
  try {
    const params = [monthStart, monthEnd];
    let sql
      = "SELECT id, player_id, type, money, create_at FROM money_logs WHERE create_at >= $1 AND create_at < $2";
    if (userId) {
      params.push(String(userId));
      sql += ` AND user_id = $${params.length}`;
    }
    else if (Array.isArray(userIds) && userIds.length) {
      params.push(userIds);
      sql += ` AND user_id = ANY($${params.length}::uuid[])`;
    }
    sql += " ORDER BY create_at DESC";
    const { rows } = await pool.query(sql, params);
    return rows || [];
  }
  catch (err) {
    console.warn("[rds] fetchMoneyLogsForMonthAggregate:", err.message);
    return [];
  }
}

export async function fetchMoneyLogsByPlayer(playerId, userId) {
  const pid = Number(playerId);
  if (!Number.isFinite(pid))
    return [];
  const pool = getPgPool();
  if (!pool)
    return [];
  try {
    const params = [pid];
    let where = "player_id = $1";
    if (userId) {
      params.push(String(userId));
      where += ` AND user_id = $${params.length}`;
    }
    const { rows } = await pool.query(
      `SELECT id, user_id, player_id, type, money, currency, description, is_auto, create_at, updated_at
       FROM money_logs WHERE ${where} ORDER BY create_at DESC`,
      params,
    );
    return rows || [];
  }
  catch (err) {
    console.warn("[rds] fetchMoneyLogsByPlayer:", err.message);
    return [];
  }
}

export async function fetchMoneyLogById(logId, userId) {
  const id = Number(logId);
  if (!Number.isFinite(id) || id <= 0)
    return null;
  const pool = getPgPool();
  if (!pool)
    return null;
  try {
    const params = [id];
    let where = "id = $1";
    if (userId) {
      params.push(String(userId));
      where += ` AND user_id = $${params.length}`;
    }
    const { rows } = await pool.query(
      `SELECT id, user_id, player_id, type, money, currency, description, is_auto, create_at, updated_at
       FROM money_logs WHERE ${where} LIMIT 1`,
      params,
    );
    return rows?.[0] ?? null;
  }
  catch (err) {
    console.warn("[rds] fetchMoneyLogById:", err.message);
    return null;
  }
}

export async function fetchAllMoneyLogs() {
  const pool = getPgPool();
  if (!pool)
    return [];
  try {
    const { rows } = await pool.query(
      `SELECT id, player_id, type, money, create_at FROM money_logs ORDER BY create_at DESC`,
    );
    return rows || [];
  }
  catch (err) {
    console.warn("[rds] fetchAllMoneyLogs:", err.message);
    return [];
  }
}

export async function upsertMoneyLog(row) {
  if (!row?.user_id || row?.player_id == null)
    return null;
  const now = Date.now();
  const payload = {
    user_id: String(row.user_id),
    player_id: Number(row.player_id),
    type: String(row.type || "Recharge"),
    money: Number(row.money) || 0,
    currency: String(row.currency || "CNY"),
    description: String(row.description || ""),
    is_auto: Number(row.is_auto) ? 1 : 0,
    create_at: Number(row.create_at) || now,
    updated_at: Number(row.updated_at) || now,
  };
  const id = Number(row.id) || 0;
  const pool = getPgPool();
  if (!pool)
    return null;
  try {
    return await _rdsUpsertMoneyLog(pool, { id: id || undefined, ...payload });
  }
  catch (err) {
    console.warn("[rds] upsertMoneyLog:", err.message);
    return null;
  }
}

export async function deleteMoneyLogById(logId, userId) {
  const id = Number(logId);
  if (!Number.isFinite(id) || id <= 0)
    return false;
  const pool = getPgPool();
  if (!pool)
    return false;
  try {
    const params = [id];
    let where = "id = $1";
    if (userId) {
      params.push(String(userId));
      where += ` AND user_id = $${params.length}`;
    }
    const res = await pool.query(`DELETE FROM money_logs WHERE ${where}`, params);
    return (res.rowCount ?? 0) > 0;
  }
  catch (err) {
    console.warn("[rds] deleteMoneyLogById:", err.message);
    return false;
  }
}

export async function deleteMoneyLogsByPlayer(playerId, userId) {
  const pid = Number(playerId);
  const uid = String(userId || "").trim();
  if (!Number.isFinite(pid) || !uid)
    return false;
  const pool = getPgPool();
  if (!pool)
    return false;
  try {
    const res = await pool.query(
      "DELETE FROM money_logs WHERE player_id = $1 AND user_id = $2::uuid",
      [pid, uid],
    );
    return (res.rowCount ?? 0) > 0;
  }
  catch (err) {
    console.warn("[rds] deleteMoneyLogsByPlayer:", err.message);
    return false;
  }
}
