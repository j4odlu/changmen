import crypto from "node:crypto";
import { getPgPool } from "./common.js";
import { ensurePgPoolReady } from "../pg_pool.js";
import { insertProfile } from "./profile_store.js";

function storageError(code) {
  return Object.assign(new Error(code), { code });
}

async function requirePool() {
  await ensurePgPoolReady();
  const pool = getPgPool();
  if (!pool) throw storageError("ADMIN_USER_STORAGE_UNAVAILABLE");
  return pool;
}

/** [changmen 扩展] Preserve the existing users → profiles write order and failure behavior. */
export async function createManagedUser(name, password, now) {
  const pool = await requirePool();
  const existing = await pool.query("SELECT id FROM users WHERE lower(user_name) = lower($1)", [name]);
  if (existing.rows.length) throw storageError("ADMIN_USER_NAME_EXISTS");
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, user_name, password_hash, metadata, created_at, updated_at)
     VALUES ($1, $2, crypt($3, gen_salt('bf', 12)), '{}', $4, $4)`,
    [id, name, password, now],
  );
  const ok = await insertProfile(id, {
    id, user_name: name, accounts: [], betting_config: {}, collect_config: {}, preferences: {},
    created_at: now, updated_at: now,
  });
  if (!ok) throw storageError("ADMIN_USER_PROFILE_CREATE_FAILED");
  return { id, userName: name };
}

export async function readManagedUserIdentity(id) {
  const pool = await requirePool();
  const { rows } = await pool.query("SELECT user_name, is_admin FROM users WHERE id = $1", [id]);
  return rows[0] || null;
}

export async function hasManagedUserName(name, excludingId) {
  const pool = await requirePool();
  const { rows } = await pool.query("SELECT id FROM users WHERE lower(user_name) = lower($1) AND id <> $2", [name, excludingId]);
  return rows.length > 0;
}

export async function deleteManagedUser(id) {
  const pool = await requirePool();
  await pool.query("DELETE FROM users WHERE id = $1", [id]);
}

export async function resetManagedUserPassword(id, password, now) {
  const pool = await requirePool();
  const { rows } = await pool.query("SELECT user_name FROM users WHERE id = $1", [id]);
  if (!rows[0]) return null;
  await pool.query("UPDATE users SET password_hash = crypt($2, gen_salt('bf', 12)), updated_at = $3 WHERE id = $1", [id, password, now]);
  return { userName: String(rows[0].user_name) };
}

export async function countManagedAdministrators() {
  const pool = await requirePool();
  const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM users WHERE is_admin = true");
  return rows[0]?.n ?? 0;
}

export async function countManagedTeamMembers(id) {
  await ensurePgPoolReady();
  const pool = getPgPool();
  // Existing deleteTeam behavior lets its existing data method report unavailable storage.
  if (!pool) return null;
  const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM users WHERE team_id = $1", [id]);
  return rows[0]?.n ?? 0;
}
