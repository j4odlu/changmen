import crypto from "node:crypto";

/** Deployment switch only: no per-user or persisted session modes. */
export function webCookieEnabled() {
  return process.env.WEB_AUTH_COOKIE_ENABLED === "1" && String(process.env.WEB_AUTH_CSRF_SECRET || "").length >= 32;
}

/** Origin allowlist is separate from CORS: missing and null are never trusted. */
export function validAuthOrigin(req) {
  const origin = String(req.headers.origin || "");
  const defaults = process.env.NODE_ENV === "production"
    ? ["https://changmen.fun"]
    : ["http://localhost:5274", "http://127.0.0.1:5274", "http://localhost:5574", "http://127.0.0.1:5574", "http://localhost:5174", "http://127.0.0.1:5174", "http://localhost:3700", "http://127.0.0.1:3700", "http://localhost:3456", "http://127.0.0.1:3456"];
  const allowed = process.env.WEB_AUTH_ORIGINS ? process.env.WEB_AUTH_ORIGINS.split(",").map(s => s.trim()) : defaults;
  return origin !== "null" && allowed.includes(origin);
}

export function sessionCsrf(session) {
  const secret = process.env.WEB_AUTH_CSRF_SECRET;
  if (!secret || secret.length < 32)
    return "";
  return crypto.createHmac("sha256", secret).update(`csrf:${session.id}:${session.jwtSessionId}`).digest("base64url");
}

export function validSessionCsrf(req, session) {
  const expected = sessionCsrf(session);
  const actual = String(req.headers["x-csrf-token"] || "");
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return Boolean(expected) && validAuthOrigin(req) && a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function browserAuthAudit(req) {
  return {
    clientIp: String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || String(req.socket?.remoteAddress || ""),
    userAgent: String(req.headers["user-agent"] || ""),
  };
}
