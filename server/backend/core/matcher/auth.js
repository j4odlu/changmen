import * as sb from "@changmen/db";
import { getProfileById, loadProfileById } from "../db/store.js";
import { resolveRequestAuth } from "../auth/request_auth.js";
import { canAccessAdminPanel } from "../account/admin_auth.js";
import {
  browserSessionEnabled,
  readBrowserSessionCookie,
} from "../auth/browser_session.js";
import {
  clientCertificateAudit,
} from "../shared/client_cert_gate.js";
import { getRequestToken, isMatcherAuthBypassed } from "@changmen/matcher/ui/matcher_auth.js";
export { validSessionCsrf } from "../auth/web_session_security.js";

function matcherAuditContext(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return {
    clientIp: forwarded || String(req.socket?.remoteAddress || ""),
    ...clientCertificateAudit(req),
    userAgent: String(req.headers["user-agent"] || ""),
  };
}

export async function resolveMatcherUser(req, dependencies = {}, host = {}) {
  if (isMatcherAuthBypassed())
    return { user: { userName: "__skip_auth__" }, bypassed: true };
  const token = getRequestToken(req);
  if (!dependencies.authBrowserSession && !dependencies.getUserByToken) {
    const resolved = await resolveRequestAuth({
      token, browserSessionToken: browserSessionEnabled() ? readBrowserSessionCookie(req) : "",
      action: "Matcher", audit: matcherAuditContext(req), protocol: req.headers["x-changmen-auth"],
    }, { authResolveBrowserSession: sb.authResolveBrowserSession, authGetUserStatus: sb.authGetUserStatus, authorizeClientCertificate: sb.authorizeClientCertificate, getProfileById, loadProfileById });
    return { user: resolved.user, bypassed: false, temporary: resolved.failure?.code === "TEMPORARY_UNAVAILABLE", session: resolved.session };
  }
  const getUserByToken = dependencies.getUserByToken || host.getUserByToken;
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

export function canAccessMatcherUi(user) {
  return canAccessAdminPanel(user);
}
