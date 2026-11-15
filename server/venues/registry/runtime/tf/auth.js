import crypto from "node:crypto";

export const PUBLIC_TOKEN = "2633b50ad4f64cd28b3224e47c877057";

export function stripTokenPrefix(token) {
  return String(token || "").replace(/^Token\s+/i, "");
}

function decodeTokenKey(token) {
  const raw = stripTokenPrefix(token);
  return Buffer.from(raw, "base64");
}

/**
 * 与 A8 bundle MBe() 一致：tf-authorization 头。
 */
export function buildTfAuthorization(token, nowSec = Math.floor(Date.now() / 1000)) {
  const key = decodeTokenKey(token);
  const e = nowSec;
  const r = nowSec;
  const n = Math.floor(Date.now() / 1000) - r + e;
  const s = Math.floor(n / 10);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(s >>> 0, 4);

  const hmac = crypto.createHmac("sha1", key);
  hmac.update(buf);
  const digest = hmac.digest();
  const c = digest[digest.length - 1] & 0x0f;
  const d =
    ((digest[c] & 0x7f) << 24) |
    (digest[c + 1] << 16) |
    (digest[c + 2] << 8) |
    digest[c + 3];
  const padded = String(d % 1e6).padStart(6, "0");
  return crypto.createHash("sha512").update(padded).digest("hex");
}

function normalizeAuthorization(token) {
  if (!token) return "";
  return /^Token\s+/i.test(token) ? token : `Token ${token}`;
}

export function tfRequestHeaders(token, extra = {}) {
  const auth = normalizeAuthorization(token);
  return {
    Accept: "application/json, text/plain, */*",
    Authorization: auth,
    "tf-authorization": buildTfAuthorization(auth),
    "public-token": PUBLIC_TOKEN,
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    ...extra,
  };
}

export { normalizeAuthorization };
