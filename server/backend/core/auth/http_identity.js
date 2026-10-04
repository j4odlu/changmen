import * as db from "@changmen/db";
import { getProfileById, loadProfileById } from "../db/store.js";
import { readClientCertStatus, clientCertCnFromSubject, clientCertificateAudit } from "../shared/client_cert_gate.js";
import { browserSessionEnabled, readBrowserSessionCookie } from "./browser_session.js";
import { resolveRequestAuth } from "./request_auth.js";
import { browserAuthAudit, validSessionCsrf } from "./web_session_security.js";

export function readAccessToken(req) {
  const bearer = String(req.headers.authorization || "").trim();
  return /^bearer\s+/i.test(bearer) ? bearer.replace(/^bearer\s+/i, "").trim()
    : String(req.headers.token || req.headers.Token || "").trim();
}

/** Adapter for native HTTP endpoints; account and role permissions remain in handlers. */
export async function requireHttpUser(req, { alwaysCsrf = false } = {}, dependencies = {}) {
  try {
    const resolved = await resolveRequestAuth({
      token: readAccessToken(req),
      browserSessionToken: browserSessionEnabled() ? readBrowserSessionCookie(req) : "",
      protocol: req.headers["x-changmen-auth"], action: "Http",
      audit: { ...browserAuthAudit(req), ...clientCertificateAudit(req) },
    }, { authResolveBrowserSession: db.authResolveBrowserSession, authGetUserStatus: db.authGetUserStatus, authorizeClientCertificate: db.authorizeClientCertificate, recordAuthAudit: db.recordAuthAudit,
      getProfileById, loadProfileById, ...dependencies });
    if (resolved.failure) {
      const code = resolved.failure.code;
      return { error: { status: code === "TEMPORARY_UNAVAILABLE" ? 503 : 401,
        body: { error: resolved.failure.msg, code } } };
    }
    if (resolved.session && (alwaysCsrf || !["GET", "HEAD"].includes(req.method)) && !validSessionCsrf(req, resolved.session))
      return { error: { status: 403, body: { error: "请求校验失败", code: "CSRF_INVALID" } } };
    return { user: resolved.user, identity: resolved.identity };
  }
  catch {
    return { error: { status: 503, body: { error: "登录服务暂时不可用", code: "TEMPORARY_UNAVAILABLE" } } };
  }
}
