import * as sb from "@changmen/db";
import { getProfileById, loadProfileById } from "../../../backend/core/db/store.js";
import { resolveRequestAuth } from "../../../backend/core/auth/request_auth.js";
import { validSessionCsrf } from "../../../backend/core/auth/web_session_security.js";
import { canAccessAdminPanel } from "../../../backend/core/account/admin_auth.js";
import {
  browserSessionEnabled,
  readBrowserSessionCookie,
} from "../../../backend/core/auth/browser_session.js";
import store from "../../../backend/core/esport-api/store.js";
import {
  clientCertCnFromSubject,
  readClientCertStatus,
} from "../../../backend/core/shared/client_cert_gate.js";
import { isMatcherSkipAuthEnabled } from "../lib/config.js";

export function isMatcherAuthBypassed() {
  return isMatcherSkipAuthEnabled();
}

export function getRequestToken(req) {
  const header
    = (typeof req.headers.token === "string" && req.headers.token)
      || (typeof req.headers.Token === "string" && req.headers.Token)
      || "";
  if (header)
    return header;
  const auth = req.headers.authorization || req.headers.Authorization;
  if (typeof auth === "string" && /^Bearer\s+/i.test(auth)) {
    return auth.replace(/^Bearer\s+/i, "").trim();
  }
  const cookies = parseCookies(req);
  const fromCookie = cookies.app_token;
  return typeof fromCookie === "string" ? fromCookie : "";
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw)
    return out;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0)
      continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function matcherAuditContext(req) {
  const cert = readClientCertStatus(req);
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return {
    clientIp: forwarded || String(req.socket?.remoteAddress || ""),
    certCn: clientCertCnFromSubject(cert.subject),
    userAgent: String(req.headers["user-agent"] || ""),
  };
}

export async function resolveMatcherUser(req, dependencies = {}) {
  if (isMatcherAuthBypassed())
    return { user: { userName: "__skip_auth__" }, bypassed: true };
  const token = getRequestToken(req);
  if (!dependencies.authBrowserSession && !dependencies.getUserByToken) {
    const resolved = await resolveRequestAuth({
      token, browserSessionToken: browserSessionEnabled() ? readBrowserSessionCookie(req) : "",
      action: "Matcher", audit: matcherAuditContext(req), protocol: req.headers["x-changmen-auth"],
    }, { authResolveBrowserSession: sb.authResolveBrowserSession, authGetUserStatus: sb.authGetUserStatus, getProfileById, loadProfileById });
    return { user: resolved.user, bypassed: false, temporary: resolved.failure?.code === "TEMPORARY_UNAVAILABLE", session: resolved.session };
  }
  const getUserByToken = dependencies.getUserByToken || store.getUserByToken.bind(store);
  if (token) {
    const user = await getUserByToken(token);
    return { user, bypassed: false };
  }

  const browserSessionToken = browserSessionEnabled() ? readBrowserSessionCookie(req) : "";
  if (!browserSessionToken)
    return { user: null, bypassed: false };
  const authBrowserSession = dependencies.authBrowserSession || sb.authBrowserSession;
  const restored = await authBrowserSession(browserSessionToken, matcherAuditContext(req));
  if (restored?.temporary)
    return { user: null, bypassed: false, temporary: true };
  if (!restored || !("accessToken" in restored))
    return { user: null, bypassed: false };
  const user = await getUserByToken(restored.accessToken);
  return { user, bypassed: false };
}

export async function isMatcherAuthed(req) {
  const { user, bypassed } = await resolveMatcherUser(req);
  if (bypassed)
    return true;
  if (!user)
    return false;
  return canAccessMatcherUi(user);
}

export function canAccessMatcherUi(user) {
  return canAccessAdminPanel(user);
}

export function createMatcherAuthMiddleware() {
  return async (req, res, next) => {
    try {
      const path = req.path || (req.url || "").split("?")[0];
      if (!path.startsWith("/api/") && path !== "/api")
        return next();

      const { user, bypassed, temporary, session } = await resolveMatcherUser(req);
      if (bypassed)
        return next();
      if (temporary) {
        return res.status(503).json({
          ok: false,
          error: "temporary_unavailable",
          message: "登录服务暂时不可用，请稍后重试",
        });
      }
      if (!user) {
        return res.status(401).json({ ok: false, error: "unauthorized", login: "/login" });
      }
      if (!canAccessMatcherUi(user)) {
        return res.status(403).json({ ok: false, error: "forbidden", message: "需要团队长或管理员权限" });
      }
      if (session && !["GET", "HEAD"].includes(req.method) && !validSessionCsrf(req, session))
        return res.status(403).json({ ok: false, error: "CSRF_INVALID" });
      return next();
    }
    catch (err) {
      console.error("[matcher] auth error:", err.message);
      if (!res.headersSent) {
        res.status(500).json({ ok: false, error: err.message });
      }
    }
  };
}
