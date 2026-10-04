import crypto from "node:crypto";
import { readDevWebPort } from "@changmen/storage/dev_web_config.js";

let devOrigins;
function localAuthOrigins() {
  if (devOrigins) return devOrigins;
  const ports = new Set([readDevWebPort(), Number(process.env.PORT || (process.platform === "win32" ? 3700 : 3456))]);
  devOrigins = [...ports].flatMap(port => ["localhost", "127.0.0.1"].map(host => `http://${host}:${port}`));
  return devOrigins;
}

/** Deployment switch only: no per-user or persisted session modes. */
export function webCookieEnabled() {
  return process.env.WEB_AUTH_COOKIE_ENABLED === "1" && String(process.env.WEB_AUTH_CSRF_SECRET || "").length >= 32;
}

/** Origin allowlist is separate from CORS: missing and null are never trusted. */
export function validAuthOrigin(req) {
  const origin = String(req.headers.origin || "");
  const allowed = process.env.WEB_AUTH_ORIGINS
    ? process.env.WEB_AUTH_ORIGINS.split(",").map(s => s.trim())
    : process.env.NODE_ENV === "production" ? ["https://changmen.fun"] : localAuthOrigins();
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
