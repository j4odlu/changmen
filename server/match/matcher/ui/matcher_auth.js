import { matcherAuthPort } from "../runtime_ports.js";
import { isMatcherSkipAuthEnabled } from "../lib/auth_config.js";
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

export async function resolveMatcherUser(req, dependencies) {
  if (isMatcherAuthBypassed()) return { user: { userName: "__skip_auth__" }, bypassed: true };
  return matcherAuthPort().resolveMatcherUser(req, dependencies);
}
export function canAccessMatcherUi(user) { return matcherAuthPort().canAccessMatcherUi(user); }
export async function isMatcherAuthed(req) {
  const { user, bypassed } = await resolveMatcherUser(req);
  if (bypassed)
    return true;
  if (!user)
    return false;
  return canAccessMatcherUi(user);
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
      if (session && !["GET", "HEAD"].includes(req.method) && !matcherAuthPort().validSessionCsrf(req, session))
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
