import * as db from "@changmen/db";
import { loadProfileById } from "../db/store.js";
import { handleClientLogin } from "../esport-api/router.js";
import { jsonResponse, readJsonBody } from "../http/body.js";
import { readClientCertStatus, clientCertCnFromSubject } from "../shared/client_cert_gate.js";
import { browserSessionEnabled, readBrowserSessionCookie } from "./browser_session.js";
import { browserAuthAudit, sessionCsrf, validAuthOrigin, validSessionCsrf, webCookieEnabled } from "./web_session_security.js";

export async function tryWebSessionRoutes(req, res) {
  const path = String(req.url || "").split("?")[0];
  if (!path.startsWith("/auth/"))
    return false;
  res.setHeader("Cache-Control", "no-store");
  const fail = (status, code) => jsonResponse(res, status, { code });
  if (path === "/auth/login") {
    if (req.method !== "POST") { fail(405, "METHOD_NOT_ALLOWED"); return true; }
    if (!webCookieEnabled() || !browserSessionEnabled()) { fail(503, "COOKIE_LOGIN_DISABLED"); return true; }
    if (!validAuthOrigin(req) || req.headers["x-changmen-auth"] !== "cookie"
      || !String(req.headers["content-type"] || "").startsWith("application/json")) {
      fail(403, "ORIGIN_INVALID"); return true;
    }
    let body;
    try { body = await readJsonBody(req); }
    catch { fail(400, "INVALID_BODY"); return true; }
    const audit = browserAuthAudit(req);
    const result = await handleClientLogin(body, audit.clientIp, readClientCertStatus(req), audit.userAgent, res);
    if (result.success === 1) {
      const { token: _token, refreshToken: _refreshToken, ...info } = result.info;
      result.info = info;
    }
    jsonResponse(res, result.success === 1 ? 200 : ["TEMPORARY_UNAVAILABLE", "LOGIN_RESULT_UNCERTAIN"].includes(result.code) ? 503 : 401, result);
    return true;
  }
  if (!["/auth/session", "/auth/logout"].includes(path)) {
    fail(404, "NOT_FOUND");
    return true;
  }
  if (req.method !== (path === "/auth/session" ? "GET" : "POST")) {
    fail(405, "METHOD_NOT_ALLOWED");
    return true;
  }
  const cookie = readBrowserSessionCookie(req);
  const audit = { ...browserAuthAudit(req), certCn: clientCertCnFromSubject(readClientCertStatus(req).subject) };
  const session = await db.authResolveBrowserSession(cookie, audit);
  if (session?.temporary) { fail(503, "TEMPORARY_UNAVAILABLE"); return true; }
  if (!session || session.invalid || session.revoked) { fail(401, "SESSION_REVOKED"); return true; }
  if (path === "/auth/session") {
    const user = await loadProfileById(session.userId);
    if (!user) { fail(503, "TEMPORARY_UNAVAILABLE"); return true; }
    jsonResponse(res, 200, {
      user: { id: user.id, userName: user.userName, role: user.role || "user" },
      browserSessionId: session.id, loginEpoch: session.jwtSessionId,
      absoluteExpiresAt: session.absoluteExpiresAt, idleExpiresAt: session.idleExpiresAt,
      cookieEnabled: webCookieEnabled(), csrfToken: sessionCsrf(session),
    });
    return true;
  }
  if (!validSessionCsrf(req, session)) { fail(403, "CSRF_INVALID"); return true; }
  let body;
  try { body = await readJsonBody(req); }
  catch { fail(400, "INVALID_BODY"); return true; }
  if (path === "/auth/logout") {
    if (body.expectedBrowserSessionId !== session.id || body.expectedLoginEpoch !== session.jwtSessionId) {
      fail(409, "SESSION_CONFLICT"); return true;
    }
    const result = await db.authSignOutBrowserSession(session, audit);
    if (result.temporary) { fail(503, "TEMPORARY_UNAVAILABLE"); return true; }
    if (result.conflict) { fail(409, "SESSION_CONFLICT"); return true; }
    jsonResponse(res, 200, { ok: true });
    return true;
  }
  return true;
}
