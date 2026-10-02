/**
 * JWT 鉴权 + users 表 session 管理。
 */

import crypto from "node:crypto";
import { authorizeClientCertificate } from "./client_certificate_store.js";
import { hasDatabaseUrlConfig } from "../resolve_database_url.js";
import { getPgPool } from "./common.js";
import {
  JWT_ACCESS_TTL_SEC,
  JWT_BROWSER_ACCESS_TTL_SEC,
  JWT_REFRESH_TTL_SEC,
  JWT_SECRET,
  decodeJwtPayload,
  signJwt,
  verifyJwt,
} from "./jwt.js";
import {
  createBrowserSession,
  getBrowserSession,
  isOpaqueRefreshToken,
  issueOpaqueRefreshToken,
  revokeBrowserSession,
  rotateOpaqueRefreshToken,
} from "./auth_session_store.js";

function cleanAuditText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function sessionIdPrefix(sessionId) {
  return cleanAuditText(sessionId, 8);
}

function auditUserId(value) {
  const id = String(value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
    ? id
    : null;
}

/** 登录态审计为 best-effort：审计库异常不得阻断用户登录或刷新。 */
export async function recordAuthAudit(event) {
  const pool = getPgPool();
  if (!pool)
    return false;
  try {
    await pool.query(
      `INSERT INTO auth_session_audit
       (user_id, user_name, event_type, result, reason_code, session_id_prefix,
        client_ip, cert_cn, user_agent, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        auditUserId(event?.userId),
        cleanAuditText(event?.userName, 160),
        cleanAuditText(event?.eventType, 48),
        cleanAuditText(event?.result, 32),
        cleanAuditText(event?.reasonCode, 64),
        sessionIdPrefix(event?.sessionId),
        cleanAuditText(event?.clientIp, 128),
        cleanAuditText(event?.certCn, 160),
        cleanAuditText(event?.userAgent, 512),
        Date.now(),
      ],
    );
    return true;
  }
  catch (err) {
    console.warn("[rds] recordAuthAudit:", err.message);
    return false;
  }
}

/** 密码登录；返回 { accessToken, refreshToken, userId, email } 或 null */
export async function authSignIn(userName, password, auditContext = {}, options = {}) {
  const name = String(userName || "").trim();
  const pwd = String(password || "");
  if (!name || !pwd)
    return null;

  const pool = getPgPool();
  if (!pool || !JWT_SECRET)
    return { error: "db", message: "auth database unavailable" };
  let client;
  try {
    const { rows } = await pool.query(
      `SELECT id, user_name, password_hash, metadata->>'active_session_id' AS active_session_id FROM users
       WHERE lower(user_name) = lower($1)
         AND password_hash = crypt($2, password_hash)`,
      [name, pwd],
    );
    let row = rows[0];
    if (!row) {
      void recordAuthAudit({
        ...auditContext,
        userName: name,
        eventType: "LOGIN",
        result: "DENIED",
        reasonCode: "INVALID_CREDENTIALS",
      });
      return null;
    }
    // 验密不长期占行锁；提交前在锁内重新验密，防止并发改密码。
    client = await pool.connect();
    await client.query("BEGIN");
    const locked = await client.query(
      `SELECT id, user_name, password_hash, metadata->>'active_session_id' AS active_session_id
       FROM users WHERE id = $1 AND password_hash = crypt($2, password_hash) FOR UPDATE`,
      [String(row.id), pwd],
    );
    row = locked.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return null;
    }
    const userId = String(row.id);
    const now = Date.now();
    await client.query(
      `INSERT INTO profiles (id, user_name, accounts, betting_config, collect_config, preferences, created_at, updated_at)
       VALUES ($1, $2, '[]'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, $3, $3)
       ON CONFLICT (id) DO NOTHING`, [userId, row.user_name, now],
    );
    const profileResult = await client.query("SELECT user_name FROM profiles WHERE id = $1", [userId]);
    if (!profileResult.rows[0])
      throw new Error("profile unavailable");
    if (options.validateProfile)
      await options.validateProfile({ id: userId, userName: profileResult.rows[0].user_name });
    const bcryptCost = Number(/^\$2[aby]\$(\d{2})\$/.exec(String(row.password_hash || ""))?.[1] || 0);
    if (bcryptCost > 0 && bcryptCost < 12) {
      await client.query(
        `UPDATE users SET password_hash = crypt($2, gen_salt('bf', 12)), updated_at = $3 WHERE id = $1`,
        [userId, pwd, Date.now()],
      );
    }
    const sessionId = crypto.randomUUID();
    const accessToken = signJwt(
      { sub: userId, typ: "access", session_id: sessionId },
      JWT_SECRET,
      JWT_ACCESS_TTL_SEC,
    );
    const browserAccessToken = signJwt(
      { sub: userId, typ: "access", session_id: sessionId },
      JWT_SECRET,
      JWT_BROWSER_ACCESS_TTL_SEC,
    );
    const opaqueRefresh = await issueOpaqueRefreshToken(userId, sessionId, auditContext, client);
    if (!opaqueRefresh)
      throw new Error("refresh creation failed");
    const refreshToken = opaqueRefresh.token;
    const browserSession = options.browserSession
      ? await createBrowserSession(userId, sessionId, auditContext, client)
      : null;
    if (options.browserSession && !browserSession)
      throw new Error("browser session creation failed");
    if (!options.browserSession) {
      await client.query("UPDATE auth_sessions SET revoked_at = $2, revoke_reason = 'NEW_LOGIN' WHERE user_id = $1 AND revoked_at IS NULL", [userId, now]);
    }
    await client.query("UPDATE auth_refresh_tokens SET revoked_at = $3, revoke_reason = 'NEW_LOGIN' WHERE user_id = $1 AND session_id <> $2 AND revoked_at IS NULL", [userId, sessionId, now]);
    const updated = await client.query(
      "UPDATE users SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb, updated_at = $3 WHERE id = $1",
      [userId, JSON.stringify({ active_session_id: sessionId }), now],
    );
    if (updated.rowCount !== 1)
      throw new Error("active session update failed");
    await client.query("COMMIT");
    _sessionCacheEvictUser(userId);
    const previousSessionId = String(row.active_session_id || "");
    if (previousSessionId && previousSessionId !== "logged_out" && previousSessionId !== sessionId) {
      void recordAuthAudit({
        ...auditContext,
        userId,
        userName: row.user_name,
        eventType: "SESSION_REVOKED",
        result: "SUCCESS",
        reasonCode: "NEW_LOGIN",
        sessionId: previousSessionId,
      });
    }
    void recordAuthAudit({
      ...auditContext,
      userId,
      userName: row.user_name,
      eventType: "LOGIN",
      result: "SUCCESS",
      reasonCode: "",
      sessionId,
    });
    return {
      accessToken,
      browserAccessToken,
      refreshToken,
      browserSession,
      userId,
      sessionId,
      email: `${row.user_name}@gamebet.local`,
    };
  }
  catch (err) {
    try { await client?.query("ROLLBACK"); }
    catch { /* original failure is retained */ }
    console.warn("[rds] authSignIn:", err.message);
    void recordAuthAudit({
      ...auditContext,
      userName: name,
      eventType: "LOGIN",
      result: "FAILED",
      reasonCode: "TEMPORARY_UNAVAILABLE",
    });
    return { error: err.code === "CERT_BIND_FAILED" ? "cert" : "db", message: err.message };
  }
  finally {
    client?.release();
  }
}

/** 登出：清除 active_session_id 使当前 token 立即失效 */
export async function authSignOut(token, auditContext = {}) {
  if (!token || !JWT_SECRET)
    return;
  const payload = verifyJwt(token, JWT_SECRET);
  if (!payload?.sub) {
    void recordAuthAudit({
      ...auditContext,
      eventType: "LOGOUT",
      result: "DENIED",
      reasonCode: "ACCESS_TOKEN_INVALID",
    });
    return;
  }
  const userId = String(payload.sub);
  const sessionId = payload.session_id ? String(payload.session_id) : "";
  if (!sessionId)
    return;
  const current = await fetchUserActiveSessionId(userId);
  if (current && current !== sessionId) {
    void recordAuthAudit({
      ...auditContext,
      userId,
      eventType: "LOGOUT",
      result: "IGNORED",
      reasonCode: "SESSION_REVOKED",
      sessionId,
    });
    return;
  }
  const pool = getPgPool();
  if (!pool)
    return;
  // 读完 current 后可能有新登录提交，必须在 UPDATE 条件里再次比较代次。
  const { rowCount } = await pool.query(
    `UPDATE users SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"active_session_id":"logged_out"}'::jsonb,
      updated_at = $3 WHERE id = $1 AND metadata->>'active_session_id' = $2`,
    [userId, sessionId, Date.now()],
  );
  const updated = rowCount === 1;
  if (updated)
    _sessionCacheEvictUser(userId);
  void recordAuthAudit({
    ...auditContext,
    userId,
    eventType: "LOGOUT",
    result: updated ? "SUCCESS" : "FAILED",
    reasonCode: updated ? "" : "TEMPORARY_UNAVAILABLE",
    sessionId,
  });
}

/** Direct Cookie logout: revoke the login epoch and its credentials atomically. */
export async function authSignOutBrowserSession(session, auditContext = {}) {
  const pool = getPgPool();
  if (!pool)
    return { temporary: true };
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const now = Date.now();
    const updated = await client.query(
      `UPDATE users SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"active_session_id":"logged_out"}'::jsonb,
       updated_at = $3 WHERE id = $1 AND metadata->>'active_session_id' = $2`,
      [session.userId, session.jwtSessionId, now],
    );
    if (updated.rowCount !== 1) {
      await client.query("ROLLBACK");
      return { conflict: true };
    }
    const revoked = await client.query(
      `UPDATE auth_sessions SET revoked_at = $4, revoke_reason = 'LOGOUT'
       WHERE id = $1 AND user_id = $2 AND jwt_session_id = $3 AND revoked_at IS NULL`,
      [session.id, session.userId, session.jwtSessionId, now],
    );
    if (revoked.rowCount !== 1)
      throw new Error("browser session changed during logout");
    await client.query(
      `UPDATE auth_refresh_tokens SET revoked_at = COALESCE(revoked_at, $3), revoke_reason = 'LOGOUT'
       WHERE user_id = $1 AND session_id = $2`,
      [session.userId, session.jwtSessionId, now],
    );
    await client.query("COMMIT");
    _sessionCacheEvictUser(session.userId);
    void recordAuthAudit({ ...auditContext, userId: session.userId, sessionId: session.jwtSessionId,
      eventType: "LOGOUT", result: "SUCCESS" });
    return { ok: true };
  }
  catch {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return { temporary: true };
  }
  finally { client?.release(); }
}

async function fetchUserActiveSessionId(userId) {
  const pool = getPgPool();
  if (!pool)
    return null;
  try {
    const { rows } = await pool.query(
      `SELECT metadata->>'active_session_id' AS sid FROM users WHERE id = $1`,
      [String(userId)],
    );
    const sid = rows[0]?.sid;
    return sid ? String(sid) : "";
  }
  catch (err) {
    console.warn("[rds] fetchUserActiveSessionId:", err.message);
    return null;
  }
}

const _sessionCache = new Map();
const SESSION_CACHE_TTL_MS = 60_000;

function _sessionCacheKey(userId, sessionId) {
  return `${userId}:${sessionId}`;
}

function _sessionCacheGet(userId, sessionId) {
  const key = _sessionCacheKey(userId, sessionId);
  const entry = _sessionCache.get(key);
  if (!entry)
    return undefined;
  if (Date.now() > entry.expireAt) {
    _sessionCache.delete(key);
    return undefined;
  }
  return entry.active;
}

function _sessionCacheSet(userId, sessionId, active) {
  _sessionCache.set(_sessionCacheKey(userId, sessionId), {
    active,
    expireAt: Date.now() + SESSION_CACHE_TTL_MS,
  });
}

function _sessionCacheEvictUser(userId) {
  const prefix = `${userId}:`;
  for (const key of _sessionCache.keys()) {
    if (key.startsWith(prefix))
      _sessionCache.delete(key);
  }
}

/** 无 active_session_id 时放行（旧会话）；有则必须与 token 内 session_id 一致。
 * DB 查询失败（返回 null）时 fail-open：JWT 已通过签名校验则放行，避免 RDS 抖动整站踢人。
 */
async function isSessionActive(userId, sessionId, reportTemporary = false, fresh = false) {
  if (!sessionId)
    return false;
  const cached = _sessionCacheGet(userId, sessionId);
  if (!fresh && cached !== undefined)
    return cached;
  const active = await fetchUserActiveSessionId(userId);
  if (active === null) {
    if (reportTemporary)
      return null;
    console.warn(`[rds] isSessionActive: db unavailable, fail-open user=${userId}`);
    return true;
  }
  // logged_out → 拒绝；空 active → 放行旧会话；否则必须匹配
  const ok = active === "logged_out"
    ? false
    : (!active || active === String(sessionId));
  _sessionCacheSet(userId, sessionId, ok);
  return ok;
}

async function setActiveSessionId(userId, sessionId) {
  const pool = getPgPool();
  if (!pool || !userId || !sessionId)
    return false;
  try {
    const { rowCount } = await pool.query(
      `UPDATE users SET metadata = metadata || $2::jsonb, updated_at = $3 WHERE id = $1`,
      [String(userId), JSON.stringify({ active_session_id: String(sessionId) }), Date.now()],
    );
    if (rowCount > 0)
      _sessionCacheEvictUser(userId);
    return rowCount > 0;
  }
  catch (err) {
    console.warn("[rds] setActiveSessionId:", err.message);
    return false;
  }
}

/** 校验 token；返回 { userId, metadata } 或 null */
export async function authGetUser(token) {
  if (!token || !JWT_SECRET)
    return null;
  const payload = verifyJwt(token, JWT_SECRET);
  if (!payload?.sub || payload.typ !== "access")
    return null;
  const sessionId = payload.session_id ? String(payload.session_id) : "";
  if (!(await isSessionActive(payload.sub, sessionId)))
    return null;
  return { userId: String(payload.sub), loginEpoch: sessionId, metadata: {} };
}

/** HTTP 鉴权区分可续期、撤销和临时故障；不改变旧 authGetUser 调用方的契约。 */
export async function authGetUserStatus(token, { fresh = false } = {}) {
  if (!token)
    return { code: "AUTH_REQUIRED" };
  if (!JWT_SECRET)
    return { code: "TEMPORARY_UNAVAILABLE" };
  // 仅用于归因：过期令牌仍须通过签名/issuer/audience 校验，绝不据此放行业务。
  const payload = verifyJwt(token, JWT_SECRET, { allowExpired: true });
  if (!payload?.sub || payload.typ !== "access")
    return { code: "AUTH_REQUIRED" };
  if (payload.exp * 1000 <= Date.now())
    return { code: "ACCESS_TOKEN_EXPIRED", userId: String(payload.sub) };
  const active = await isSessionActive(payload.sub, String(payload.session_id || ""), true, fresh);
  if (active === null)
    return { code: "TEMPORARY_UNAVAILABLE", userId: String(payload.sub) };
  if (!active)
    return { code: "SESSION_REVOKED", userId: String(payload.sub) };
  return { userId: String(payload.sub), loginEpoch: String(payload.session_id || ""), metadata: {} };
}

/**
 * 仅校验 access JWT 签名/过期，不查 session（Hub 健康页归因；API 鉴权勿用）。
 * @returns {{ userId: string } | null}
 */
export function authPeekAccessToken(token) {
  if (!token || !JWT_SECRET)
    return null;
  const payload = verifyJwt(token, JWT_SECRET);
  if (!payload?.sub || payload.typ !== "access")
    return null;
  return { userId: String(payload.sub) };
}

/** 用 refresh token 换取新的 access/refresh token；{ revoked: true } 表示已在别处登录 */
export async function authRefreshToken(refreshToken, auditContext = {}) {
  if (!JWT_SECRET)
    return { temporary: true };
  let userId = "";
  let sessionId = "";
  let rotatedRefreshToken = "";
  if (isOpaqueRefreshToken(refreshToken)) {
    const rotated = await rotateOpaqueRefreshToken(refreshToken, auditContext);
    if (rotated?.temporary)
      return { temporary: true };
    if (rotated?.replayed) {
      void recordAuthAudit({
        ...auditContext,
        eventType: "REFRESH",
        result: "DENIED",
        reasonCode: "REFRESH_TOKEN_REPLAY",
      });
      return { revoked: true, replayed: true };
    }
    if (rotated?.revoked)
      return { revoked: true };
    if (!rotated || rotated.invalid || !rotated.userId)
      return { invalid: true };
    userId = String(rotated.userId);
    sessionId = String(rotated.sessionId || "");
    rotatedRefreshToken = String(rotated.refreshToken || "");
  }
  else {
    const payload = verifyJwt(refreshToken, JWT_SECRET);
    if (!payload?.sub || payload.typ !== "refresh") {
      const decoded = decodeJwtPayload(refreshToken);
      void recordAuthAudit({
        ...auditContext,
        userId: decoded?.sub,
        eventType: "REFRESH",
        result: "DENIED",
        reasonCode: "REFRESH_TOKEN_EXPIRED",
        sessionId: decoded?.session_id,
      });
      return { invalid: true };
    }
    userId = String(payload.sub);
    sessionId = payload.session_id ? String(payload.session_id) : "";
  }
  if (!sessionId) {
    void recordAuthAudit({
      ...auditContext,
      userId,
      eventType: "REFRESH",
      result: "DENIED",
      reasonCode: "SESSION_REVOKED",
    });
    return { revoked: true };
  }
  if (await authorizeClientCertificate(auditContext, userId))
    return { revoked: true };
  const active = await fetchUserActiveSessionId(userId);
  if (active === null) {
    void recordAuthAudit({
      ...auditContext,
      userId,
      eventType: "REFRESH",
      result: "FAILED",
      reasonCode: "TEMPORARY_UNAVAILABLE",
      sessionId,
    });
    return { temporary: true };
  }
  if (active && active !== sessionId) {
    void recordAuthAudit({
      ...auditContext,
      userId,
      eventType: "REFRESH",
      result: "DENIED",
      reasonCode: "SESSION_REVOKED",
      sessionId,
    });
    return { revoked: true };
  }
  const pool = getPgPool();
  if (!pool)
    return { temporary: true };
  try {
    const { rows } = await pool.query(
      "SELECT user_name FROM users WHERE id = $1",
      [userId],
    );
    const row = rows[0];
    if (!row) {
      void recordAuthAudit({
        ...auditContext,
        userId,
        eventType: "REFRESH",
        result: "DENIED",
        reasonCode: "REFRESH_TOKEN_EXPIRED",
        sessionId,
      });
      return { invalid: true };
    }
    const accessToken = signJwt(
      { sub: userId, typ: "access", session_id: sessionId },
      JWT_SECRET,
      JWT_ACCESS_TTL_SEC,
    );
    const browserAccessToken = signJwt(
      { sub: userId, typ: "access", session_id: sessionId },
      JWT_SECRET,
      JWT_BROWSER_ACCESS_TTL_SEC,
    );
    const issuedRefresh = rotatedRefreshToken
      ? null
      : await issueOpaqueRefreshToken(userId, sessionId, auditContext);
    const newRefresh = rotatedRefreshToken || issuedRefresh?.token || signJwt(
      { sub: userId, typ: "refresh", session_id: sessionId },
      JWT_SECRET,
      JWT_REFRESH_TTL_SEC,
    );
    void recordAuthAudit({
      ...auditContext,
      userId,
      userName: row.user_name,
      eventType: "REFRESH",
      result: "SUCCESS",
      reasonCode: "",
      sessionId,
    });
    return {
      accessToken,
      browserAccessToken,
      refreshToken: newRefresh,
      userId,
      sessionId,
      email: `${row.user_name}@gamebet.local`,
    };
  }
  catch (err) {
    console.warn("[rds] authRefreshToken:", err.message);
    void recordAuthAudit({
      ...auditContext,
      userId,
      eventType: "REFRESH",
      result: "FAILED",
      reasonCode: "TEMPORARY_UNAVAILABLE",
      sessionId,
    });
    return { temporary: true };
  }
}

/** 用 HttpOnly 浏览器会话换取短期 access token；浏览器会话密钥不返回给 JS。 */
export async function authResolveBrowserSession(browserSessionToken, auditContext = {}) {
  if (!JWT_SECRET)
    return { temporary: true };
  const session = await getBrowserSession(browserSessionToken, auditContext);
  if (session?.temporary)
    return { temporary: true };
  if (!session || session.invalid || session.revoked) {
    void recordAuthAudit({
      ...auditContext,
      userId: session?.userId,
      eventType: "SESSION_RESTORE",
      result: "DENIED",
      reasonCode: session?.reasonCode || "BROWSER_SESSION_INVALID",
    });
    return session?.revoked ? { revoked: true } : { invalid: true };
  }
  const pool = getPgPool();
  if (!pool)
    return { temporary: true };
  try {
    const { rows } = await pool.query(
      "SELECT user_name, metadata->>'active_session_id' AS active_session_id FROM users WHERE id = $1",
      [session.userId],
    );
    const row = rows[0];
    if (!row)
      return { invalid: true };
    if (String(row.active_session_id || "") !== session.jwtSessionId) {
      await revokeBrowserSession(browserSessionToken, "SESSION_REVOKED");
      return { revoked: true };
    }
    return {
      ...session,
      userId: session.userId,
      email: `${row.user_name}@gamebet.local`,
    };
  }
  catch (err) {
    console.warn("[rds] authBrowserSession:", err.message);
    return { temporary: true };
  }
}

/** Only legacy refresh callers need a JWT; ordinary Cookie auth uses the identity directly. */
export async function authBrowserSession(browserSessionToken, auditContext = {}) {
  const session = await authResolveBrowserSession(browserSessionToken, auditContext);
  if (!session?.userId || session.invalid || session.revoked || session.temporary)
    return session;
  return {
    ...session,
    accessToken: signJwt({ sub: session.userId, typ: "access", session_id: session.jwtSessionId }, JWT_SECRET, JWT_BROWSER_ACCESS_TTL_SEC),
  };
}

export function isAuthConfigured() {
  return !!(hasDatabaseUrlConfig() && JWT_SECRET.length >= 16);
}
