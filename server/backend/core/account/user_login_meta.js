import { recordUserLoginMetadata } from "@changmen/db/profile_metadata.js";

export function readPreferences(row) {
  const prefs = row?.preferences;
  if (prefs && typeof prefs === "object" && !Array.isArray(prefs))
    return prefs;
  return {};
}

/** 不进入管理端「买入参数」展示的系统 preferences 字段 */
export const PROFILE_META_PREFERENCE_KEYS = new Set([
  "lastLoginIp",
  "lastLoginAt",
  "lastActiveAt",
]);

export function normalizeClientIp(raw) {
  const ip = String(raw || "").trim();
  if (!ip)
    return "";
  if (ip === "::1")
    return "127.0.0.1";
  if (ip.startsWith("::ffff:"))
    return ip.slice(7);
  return ip;
}

export function lastLoginFieldsFromProfile(row) {
  const prefs = readPreferences(row);
  return {
    lastLoginIp: String(prefs.lastLoginIp || ""),
    lastLoginAt: Number(prefs.lastLoginAt) || 0,
  };
}

/** 登录成功时写入 profiles.preferences */
export async function recordUserLastLogin(userId, clientIp) {
  const uid = String(userId || "").trim();
  const ip = normalizeClientIp(clientIp);
  if (!uid || !ip)
    return false;
  return recordUserLoginMetadata(uid, ip);
}
