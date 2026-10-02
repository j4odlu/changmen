/**
 * profiles 表读写及 users 用户名/管理员/metadata 更新。
 */

import { _jsonb, getPgPool } from "./common.js";

const PROFILE_WITH_ADMIN_FROM = `
  FROM profiles p
  JOIN users u ON u.id = p.id`;

/** 拉取所有 profiles 到内存（启动时调用） */
export async function fetchProfiles() {
  const pool = getPgPool();
  if (!pool)
    return [];
  try {
    const { rows } = await pool.query(`SELECT p.*, u.is_admin, u.role, u.team_id,
      (u.metadata->'leaderboardExcluded' = 'true'::jsonb) AS leaderboard_excluded ${PROFILE_WITH_ADMIN_FROM}`);
    return rows || [];
  }
  catch (err) {
    console.error("[rds] fetchProfiles 失败:", err.message);
    return [];
  }
}

/** 按 uid 读单个 profile */
export async function fetchProfileById(uid) {
  const pool = getPgPool();
  if (!pool)
    return null;
  try {
    const { rows } = await pool.query(
      `SELECT p.*, u.is_admin, u.role, u.team_id ${PROFILE_WITH_ADMIN_FROM} WHERE p.id = $1`,
      [String(uid)],
    );
    return rows[0] || null;
  }
  catch (err) {
    console.warn("[rds] fetchProfileById:", err.message);
    return null;
  }
}

const PROFILE_JSONB_COLS = new Set(["accounts", "betting_config", "collect_config", "preferences"]);

/** 由 patch 构建 `UPDATE profiles` 的 SQL + 参数；无可写列时返回 null */
function buildProfileUpdate(uid, patch) {
  const keys = Object.keys(patch).filter(k => k !== "updated_at");
  if (!keys.length)
    return null;
  const sets = [];
  const vals = [String(uid)];
  for (const k of keys) {
    vals.push(PROFILE_JSONB_COLS.has(k) ? _jsonb(patch[k], patch[k]) : patch[k]);
    sets.push(PROFILE_JSONB_COLS.has(k) ? `${k} = $${vals.length}::jsonb` : `${k} = $${vals.length}`);
  }
  vals.push(Date.now());
  sets.push(`updated_at = $${vals.length}`);
  return { sql: `UPDATE profiles SET ${sets.join(", ")} WHERE id = $1`, vals };
}

/** fire-and-forget：更新 profile 字段 */
export function writeProfile(uid, patch) {
  const pool = getPgPool();
  if (!pool)
    return;
  const q = buildProfileUpdate(uid, patch);
  if (!q)
    return;
  Promise.resolve()
    .then(() => pool.query(q.sql, q.vals))
    .catch(err => console.warn("[rds:profiles]", err.message));
}

/**
 * await 版：更新 profile 字段，失败向上抛（关键写路径用，供上层回滚内存 / 反馈失败）。
 * 无 pool（未接 RDS）或无可写列时视为 no-op，正常返回。
 */
export async function writeProfileAsync(uid, patch) {
  const pool = getPgPool();
  if (!pool)
    return;
  const q = buildProfileUpdate(uid, patch);
  if (!q)
    return;
  await pool.query(q.sql, q.vals);
}

/** 在 profiles 表中创建新用户行（首次登录触发器未执行时的兜底） */
export async function insertProfile(uid, data) {
  const pool = getPgPool();
  if (!pool)
    return false;
  const rdsArgs = [
    String(data.id || uid),
    String(data.user_name || ""),
    JSON.stringify(data.accounts ?? []),
    JSON.stringify(data.betting_config ?? {}),
    JSON.stringify(data.collect_config ?? {}),
    JSON.stringify(data.preferences ?? {}),
    Number(data.created_at) || Date.now(),
    Number(data.updated_at) || Date.now(),
  ];
  try {
    await pool.query(
      `INSERT INTO profiles (id, user_name, accounts, betting_config, collect_config, preferences, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8)
       ON CONFLICT (id) DO NOTHING`,
      rdsArgs,
    );
    return true;
  }
  catch (err) {
    console.warn("[rds] insertProfile:", err.message);
    return false;
  }
}

/** fire-and-forget：替换用户账号列表 */
export function writeAccounts(uid, accounts) {
  writeProfile(uid, { accounts });
}

/** 管理端：全量 profiles 摘要 */
export async function fetchProfilesAdmin() {
  const pool = getPgPool();
  if (!pool)
    return [];
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.user_name, p.accounts, p.betting_config, p.collect_config, p.preferences,
              p.created_at, p.updated_at, u.is_admin, u.role, u.team_id
       ${PROFILE_WITH_ADMIN_FROM}
       ORDER BY p.user_name ASC`,
    );
    return rows || [];
  }
  catch (err) {
    console.warn("[rds] fetchProfilesAdmin:", err.message);
    return [];
  }
}

/** 写入 user metadata（fire-and-forget；单 session 请用 setActiveSessionId） */
export function writeUserMetadata(userId, metadata) {
  const pool = getPgPool();
  if (!pool)
    return;
  Promise.resolve()
    .then(() =>
      pool.query(
        "UPDATE users SET metadata = metadata || $2::jsonb, updated_at = $3 WHERE id = $1",
        [String(userId), JSON.stringify(metadata || {}), Date.now()],
      ),
    )
    .catch(err => console.warn("[rds] writeUserMetadata:", err.message));
}

/** [changmen 扩展] 排行榜排除配置属于管理策略，不放入用户可写的 preferences。 */
export async function fetchLeaderboardUsers() {
  const pool = getPgPool();
  if (!pool)
    throw new Error("数据库不可用");
  const { rows } = await pool.query(`SELECT id, user_name, is_admin, role,
    (metadata->'leaderboardExcluded' = 'true'::jsonb) AS leaderboard_excluded
    FROM users ORDER BY user_name ASC`);
  return rows;
}

export async function setUserLeaderboardExcluded(userId, excluded) {
  const pool = getPgPool();
  if (!pool)
    throw new Error("数据库不可用");
  const { rows } = await pool.query(`UPDATE users
    SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb, updated_at = $3
    WHERE id = $1 RETURNING id, user_name, is_admin, role,
    (metadata->'leaderboardExcluded' = 'true'::jsonb) AS leaderboard_excluded`,
  [String(userId), JSON.stringify({ leaderboardExcluded: excluded }), Date.now()]);
  if (!rows.length)
    throw new Error("用户不存在");
  return rows[0];
}

/** 更新登录用户名（users + profiles 同步） */
export async function updateUserName(userId, userName) {
  const pool = getPgPool();
  if (!pool)
    return false;
  const id = String(userId);
  const name = String(userName);
  const now = Date.now();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const u = await client.query(
      "UPDATE users SET user_name = $2, updated_at = $3 WHERE id = $1",
      [id, name, now],
    );
    if (!u.rowCount) {
      await client.query("ROLLBACK");
      return false;
    }
    const p = await client.query(
      "UPDATE profiles SET user_name = $2, updated_at = $3 WHERE id = $1",
      [id, name, now],
    );
    if (!p.rowCount) {
      await client.query("ROLLBACK");
      return false;
    }
    await client.query("COMMIT");
    return true;
  }
  catch (err) {
    await client.query("ROLLBACK");
    if (err.code === "23505") {
      const dup = new Error("用户名已存在");
      dup.code = "DUPLICATE_USER_NAME";
      throw dup;
    }
    console.warn("[rds] updateUserName:", err.message);
    throw err;
  }
  finally {
    client.release();
  }
}

/** 更新用户管理员标志 */
export async function updateUserIsAdmin(userId, isAdmin) {
  const pool = getPgPool();
  if (!pool)
    return false;
  try {
    const { rowCount } = await pool.query(
      `UPDATE users SET is_admin = $2, updated_at = $3 WHERE id = $1`,
      [String(userId), Boolean(isAdmin), Date.now()],
    );
    return rowCount > 0;
  }
  catch (err) {
    console.warn("[rds] updateUserIsAdmin:", err.message);
    return false;
  }
}

const VALID_ROLES = ["admin", "leader", "user"];

/** 更新用户角色，同步 is_admin */
export async function updateUserRole(userId, role) {
  const pool = getPgPool();
  if (!pool)
    return false;
  if (!VALID_ROLES.includes(role))
    return false;
  try {
    const { rowCount } = await pool.query(
      `UPDATE users SET role = $2, is_admin = $3, updated_at = $4 WHERE id = $1`,
      [String(userId), role, role === "admin", Date.now()],
    );
    return rowCount > 0;
  }
  catch (err) {
    console.warn("[rds] updateUserRole:", err.message);
    return false;
  }
}

/** 更新用户所属团队 */
export async function updateUserTeamId(userId, teamId) {
  const pool = getPgPool();
  if (!pool)
    return false;
  try {
    const { rowCount } = await pool.query(
      `UPDATE users SET team_id = $2, updated_at = $3 WHERE id = $1`,
      [String(userId), teamId || null, Date.now()],
    );
    return rowCount > 0;
  }
  catch (err) {
    console.warn("[rds] updateUserTeamId:", err.message);
    return false;
  }
}

// ── teams 表 CRUD ──────────────────────────────────────────────────

export async function fetchTeams() {
  const pool = getPgPool();
  if (!pool)
    return [];
  try {
    const { rows } = await pool.query("SELECT * FROM teams ORDER BY name ASC");
    return rows || [];
  }
  catch (err) {
    console.warn("[rds] fetchTeams:", err.message);
    return [];
  }
}

export async function upsertTeam(id, name) {
  const pool = getPgPool();
  if (!pool)
    return false;
  const now = Date.now();
  try {
    await pool.query(
      `INSERT INTO teams (id, name, created_at, updated_at) VALUES ($1, $2, $3, $3)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = EXCLUDED.updated_at`,
      [String(id), String(name), now],
    );
    return true;
  }
  catch (err) {
    console.warn("[rds] upsertTeam:", err.message);
    return false;
  }
}

export async function deleteTeam(id) {
  const pool = getPgPool();
  if (!pool)
    return false;
  try {
    const { rowCount } = await pool.query("DELETE FROM teams WHERE id = $1", [String(id)]);
    return rowCount > 0;
  }
  catch (err) {
    console.warn("[rds] deleteTeam:", err.message);
    return false;
  }
}
