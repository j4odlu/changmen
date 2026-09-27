import crypto from "node:crypto";
import { getPgPool } from "./common.js";

const BROWSER_SESSION_PREFIX = "bs1";
const REFRESH_TOKEN_PREFIX = "rt1";
const BROWSER_IDLE_MS = 8 * 60 * 60 * 1000;
const BROWSER_ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000;
const REFRESH_TOKEN_MS = 30 * 24 * 60 * 60 * 1000;

function clean(value, maxLength = 512) {
  return String(value || "").trim().slice(0, maxLength);
}

function secretHash(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function hashMatches(actual, expected) {
  const left = Buffer.from(String(actual || ""), "hex");
  const right = Buffer.from(String(expected || ""), "hex");
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

function newOpaqueToken(prefix) {
  const id = crypto.randomUUID();
  const secret = crypto.randomBytes(32).toString("base64url");
  return { id, secret, token: `${prefix}.${id}.${secret}` };
}

function replacementOpaqueToken(previousSecret, id = crypto.randomUUID()) {
  const pepper = String(process.env.REFRESH_TOKEN_PEPPER || process.env.JWT_SECRET || "");
  const secret = crypto
    .createHmac("sha256", pepper)
    .update(`refresh-rotation:${previousSecret}:${id}`, "utf8")
    .digest("base64url");
  return { id, secret, token: `${REFRESH_TOKEN_PREFIX}.${id}.${secret}` };
}

function parseOpaqueToken(value, prefix) {
  const parts = String(value || "").split(".");
  if (parts.length !== 3 || parts[0] !== prefix)
    return null;
  const id = parts[1];
  const secret = parts[2];
  if (!/^[0-9a-f-]{36}$/i.test(id) || secret.length < 32)
    return null;
  return { id, secret };
}

export function isOpaqueRefreshToken(value) {
  return Boolean(parseOpaqueToken(value, REFRESH_TOKEN_PREFIX));
}

export async function createBrowserSession(userId, jwtSessionId, context = {}) {
  const pool = getPgPool();
  if (!pool)
    return null;
  const createdAt = Date.now();
  const opaque = newOpaqueToken(BROWSER_SESSION_PREFIX);
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query(
      `UPDATE auth_sessions
       SET revoked_at = $2, revoke_reason = 'NEW_LOGIN'
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [String(userId), createdAt],
    );
    await client.query(
      `INSERT INTO auth_sessions
       (id, user_id, jwt_session_id, secret_hash, cert_cn, client_ip, user_agent, created_at,
        last_seen_at, idle_expires_at, absolute_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10)`,
      [
        opaque.id,
        String(userId),
        String(jwtSessionId),
        secretHash(opaque.secret),
        clean(context.certCn, 160),
        clean(context.clientIp, 128),
        clean(context.userAgent, 512),
        createdAt,
        createdAt + BROWSER_IDLE_MS,
        createdAt + BROWSER_ABSOLUTE_MS,
      ],
    );
    await client.query("COMMIT");
    return { token: opaque.token, absoluteExpiresAt: createdAt + BROWSER_ABSOLUTE_MS };
  }
  catch (err) {
    try { await client?.query("ROLLBACK"); }
    catch { /* ignore */ }
    console.warn("[rds] createBrowserSession:", err.message);
    return null;
  }
  finally {
    client?.release();
  }
}

export async function getBrowserSession(value, context = {}) {
  const parsed = parseOpaqueToken(value, BROWSER_SESSION_PREFIX);
  if (!parsed)
    return null;
  const pool = getPgPool();
  if (!pool)
    return { temporary: true };
  try {
    const now = Date.now();
    const { rows } = await pool.query(
      `SELECT id, user_id, jwt_session_id, secret_hash, cert_cn, idle_expires_at, absolute_expires_at
       FROM auth_sessions
       WHERE id = $1 AND revoked_at IS NULL`,
      [parsed.id],
    );
    const row = rows[0];
    if (!row || !hashMatches(row.secret_hash, secretHash(parsed.secret)))
      return null;
    if (Number(row.idle_expires_at) <= now || Number(row.absolute_expires_at) <= now)
      return null;
    const storedCertCn = clean(row.cert_cn, 160).toLowerCase();
    const requestCertCn = clean(context.certCn, 160).toLowerCase();
    if (storedCertCn && storedCertCn !== requestCertCn)
      return null;
    const nextIdle = Math.min(now + BROWSER_IDLE_MS, Number(row.absolute_expires_at));
    await pool.query(
      `UPDATE auth_sessions SET last_seen_at = $2, idle_expires_at = $3 WHERE id = $1`,
      [parsed.id, now, nextIdle],
    );
    return {
      id: String(row.id),
      userId: String(row.user_id),
      jwtSessionId: String(row.jwt_session_id),
    };
  }
  catch (err) {
    console.warn("[rds] getBrowserSession:", err.message);
    return { temporary: true };
  }
}

export async function revokeBrowserSession(value, reason = "LOGOUT") {
  const parsed = parseOpaqueToken(value, BROWSER_SESSION_PREFIX);
  const pool = getPgPool();
  if (!parsed || !pool)
    return false;
  try {
    const { rowCount } = await pool.query(
      `UPDATE auth_sessions
       SET revoked_at = COALESCE(revoked_at, $2), revoke_reason = $3
       WHERE id = $1 AND secret_hash = $4`,
      [parsed.id, Date.now(), clean(reason, 64), secretHash(parsed.secret)],
    );
    return rowCount > 0;
  }
  catch (err) {
    console.warn("[rds] revokeBrowserSession:", err.message);
    return false;
  }
}

async function insertRefreshToken(queryable, userId, sessionId, context, familyId, suppliedOpaque = null) {
  const opaque = suppliedOpaque || newOpaqueToken(REFRESH_TOKEN_PREFIX);
  const now = Date.now();
  await queryable.query(
    `INSERT INTO auth_refresh_tokens
     (id, family_id, user_id, session_id, secret_hash, cert_cn, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      opaque.id,
      familyId,
      String(userId),
      String(sessionId),
      secretHash(opaque.secret),
      clean(context?.certCn, 160),
      now,
      now + REFRESH_TOKEN_MS,
    ],
  );
  return { id: opaque.id, token: opaque.token, expiresAt: now + REFRESH_TOKEN_MS };
}

export async function issueOpaqueRefreshToken(userId, sessionId, context = {}) {
  const pool = getPgPool();
  if (!pool)
    return null;
  try {
    return await insertRefreshToken(pool, userId, sessionId, context, crypto.randomUUID());
  }
  catch (err) {
    console.warn("[rds] issueOpaqueRefreshToken:", err.message);
    return null;
  }
}

export async function rotateOpaqueRefreshToken(value, context = {}) {
  const parsed = parseOpaqueToken(value, REFRESH_TOKEN_PREFIX);
  if (!parsed)
    return { invalid: true };
  const pool = getPgPool();
  if (!pool)
    return { temporary: true };
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT id, family_id, user_id, session_id, secret_hash, cert_cn,
              expires_at, used_at, revoked_at, replaced_by_id
       FROM auth_refresh_tokens WHERE id = $1 FOR UPDATE`,
      [parsed.id],
    );
    const row = rows[0];
    if (!row || !hashMatches(row.secret_hash, secretHash(parsed.secret)) || Number(row.expires_at) <= Date.now()) {
      await client.query("ROLLBACK");
      return { invalid: true };
    }
    const storedCertCn = clean(row.cert_cn, 160).toLowerCase();
    const requestCertCn = clean(context.certCn, 160).toLowerCase();
    if (storedCertCn && storedCertCn !== requestCertCn) {
      await client.query(
        `UPDATE auth_refresh_tokens SET revoked_at = $2, revoke_reason = 'CERT_MISMATCH'
         WHERE family_id = $1 AND revoked_at IS NULL`,
        [row.family_id, Date.now()],
      );
      await client.query("COMMIT");
      return { revoked: true };
    }
    if (row.revoked_at) {
      await client.query(
        `UPDATE auth_refresh_tokens SET revoked_at = COALESCE(revoked_at, $2), revoke_reason = 'TOKEN_REPLAY'
         WHERE family_id = $1`,
        [row.family_id, Date.now()],
      );
      await client.query("COMMIT");
      return { replayed: true, revoked: true };
    }
    if (row.used_at) {
      const replacementId = String(row.replaced_by_id || "");
      const replacement = replacementId
        ? replacementOpaqueToken(parsed.secret, replacementId)
        : null;
      const replacementResult = replacement
        ? await client.query(
            `SELECT secret_hash, expires_at, used_at, revoked_at
             FROM auth_refresh_tokens WHERE id = $1`,
            [replacementId],
          )
        : { rows: [] };
      const replacementRow = replacementResult.rows[0];
      // 首次轮换的响应可能丢失：只要替换令牌还没被使用，就幂等返回同一个令牌。
      // 一旦令牌链继续向前，旧令牌再次出现即视为真实重放并撤销整族。
      if (
        replacement
        && replacementRow
        && hashMatches(replacementRow.secret_hash, secretHash(replacement.secret))
        && !replacementRow.used_at
        && !replacementRow.revoked_at
        && Number(replacementRow.expires_at) > Date.now()
      ) {
        await client.query("COMMIT");
        return {
          userId: String(row.user_id),
          sessionId: String(row.session_id),
          refreshToken: replacement.token,
          retried: true,
        };
      }
      await client.query(
        `UPDATE auth_refresh_tokens SET revoked_at = COALESCE(revoked_at, $2), revoke_reason = 'TOKEN_REPLAY'
         WHERE family_id = $1`,
        [row.family_id, Date.now()],
      );
      await client.query("COMMIT");
      return { replayed: true, revoked: true };
    }
    const replacementOpaque = replacementOpaqueToken(parsed.secret);
    const replacement = await insertRefreshToken(
      client,
      row.user_id,
      row.session_id,
      context,
      row.family_id,
      replacementOpaque,
    );
    await client.query(
      `UPDATE auth_refresh_tokens SET used_at = $2, replaced_by_id = $3 WHERE id = $1`,
      [row.id, Date.now(), replacement.id],
    );
    await client.query("COMMIT");
    return {
      userId: String(row.user_id),
      sessionId: String(row.session_id),
      refreshToken: replacement.token,
    };
  }
  catch (err) {
    try { await client?.query("ROLLBACK"); }
    catch { /* ignore */ }
    console.warn("[rds] rotateOpaqueRefreshToken:", err.message);
    return { temporary: true };
  }
  finally {
    client?.release();
  }
}
