/**
 * JWT 签发与校验（RDS auth 段使用）。
 */

import crypto from "node:crypto";

export const JWT_SECRET = process.env.JWT_SECRET || "";
export const JWT_ISSUER = process.env.JWT_ISSUER || "changmen-auth";
export const JWT_AUDIENCE = process.env.JWT_AUDIENCE || "changmen-api";

export function parseJwtTtl(raw, fallbackSec) {
  const s = String(raw || "").trim();
  if (!s)
    return fallbackSec;
  const m = s.match(/^(\d+)([smhd])?$/i);
  if (!m)
    return fallbackSec;
  const n = Number(m[1]);
  const u = (m[2] || "s").toLowerCase();
  const mult = { s: 1, m: 60, h: 3600, d: 86400 };
  return n * (mult[u] || 1);
}

export const JWT_ACCESS_TTL_SEC = parseJwtTtl(process.env.JWT_ACCESS_TTL, 15 * 60);
export const JWT_BROWSER_ACCESS_TTL_SEC = parseJwtTtl(process.env.JWT_BROWSER_ACCESS_TTL, 15 * 60);
export const JWT_REFRESH_TTL_SEC = parseJwtTtl(process.env.JWT_REFRESH_TTL, 30 * 86400);

export function signJwt(payload, secret, ttlSec) {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const body = {
    iss: JWT_ISSUER,
    aud: JWT_AUDIENCE,
    jti: crypto.randomUUID(),
    ...payload,
    iat: now,
    exp: now + ttlSec,
  };
  const h = Buffer.from(JSON.stringify(header)).toString("base64url");
  const p = Buffer.from(JSON.stringify(body)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${sig}`;
}

export function verifyJwt(token, secret) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3)
    return null;
  const [h, p, sig] = parts;
  let header;
  try { header = JSON.parse(Buffer.from(h, "base64url").toString("utf8")); }
  catch { return null; }
  if (header?.alg !== "HS256" || header?.typ !== "JWT")
    return null;
  const expected = crypto.createHmac("sha256", secret).update(`${h}.${p}`).digest();
  let supplied;
  try { supplied = Buffer.from(sig, "base64url"); }
  catch { return null; }
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected))
    return null;
  try {
    const payload = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
    if (!Number.isFinite(payload.exp) || payload.exp * 1000 < Date.now())
      return null;
    const hasModernClaims = payload.iss != null || payload.aud != null || payload.jti != null;
    if (hasModernClaims && (payload.iss !== JWT_ISSUER || payload.aud !== JWT_AUDIENCE || !payload.jti))
      return null;
    return payload;
  }
  catch {
    return null;
  }
}

export function decodeJwtPayload(token) {
  try {
    const p = String(token || "").split(".")[1];
    if (!p)
      return null;
    return JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
  }
  catch {
    return null;
  }
}
