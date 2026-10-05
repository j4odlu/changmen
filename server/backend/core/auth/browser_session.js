import { cookieOnlyAuth } from "@changmen/storage/auth_mode.js";
const PROD_COOKIE_NAME = "__Host-cm_session";
const DEV_COOKIE_NAME = "cm_session";

export function browserSessionEnabled() {
  const mode = String(process.env.AUTH_MODE || "dual").trim().toLowerCase();
  // 历史生产配置 AUTH_MODE=jwt 等同双轨；显式 legacy 才关闭新浏览器会话。
  return mode !== "legacy" && mode !== "off";
}

export function browserSessionCookieName() {
  return process.env.NODE_ENV === "production" ? PROD_COOKIE_NAME : DEV_COOKIE_NAME;
}

export function readCookie(req, name) {
  const raw = String(req?.headers?.cookie || "");
  for (const part of raw.split(";")) {
    const index = part.indexOf("=");
    if (index < 0)
      continue;
    const key = part.slice(0, index).trim();
    if (key !== name)
      continue;
    try { return decodeURIComponent(part.slice(index + 1).trim()); }
    catch { return ""; }
  }
  return "";
}

export function readBrowserSessionCookie(req) {
  return readCookie(req, browserSessionCookieName());
}

function cookieSecurityAttributes() {
  return process.env.NODE_ENV === "production" ? "; Secure" : "";
}

export function setBrowserSessionCookie(res, token, expiresAt) {
  // [changmen 扩展] 保存期限为 30 天；使用期间通过串行 POST 续期。
  const maxAge = cookieOnlyAuth() ? 30 * 24 * 60 * 60 : Math.max(0, Math.floor((Number(expiresAt) - Date.now()) / 1000));
  res.setHeader(
    "Set-Cookie",
    `${browserSessionCookieName()}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${cookieSecurityAttributes()}`,
  );
}

export function clearBrowserSessionCookie(res) {
  res.setHeader(
    "Set-Cookie",
    `${browserSessionCookieName()}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${cookieSecurityAttributes()}`,
  );
}
