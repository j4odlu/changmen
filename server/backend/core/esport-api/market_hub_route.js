/**
 * Market hub 分流（202 配置）。
 * 落盘：ESPORT_DATA_DIR/market_hub_route.json；未落盘时回退 env，再回退默认。
 *
 * primaryUsers → primaryOrigin（默认 ws.changmen.fun / 202）
 * 其他人：默认全员 202。单一 hub，不再允许配置 secondary。
 */
import { readJsonFile, writeJsonFile } from "@changmen/storage/json_file_store";

const FILE = "market_hub_route";

export const MARKET_HUB_ALLOWED_ORIGINS = Object.freeze([
  "https://ws.changmen.fun",
]);

export const MARKET_HUB_DEFAULT_PRIMARY_ORIGIN = MARKET_HUB_ALLOWED_ORIGINS[0];
export const MARKET_HUB_DEFAULT_SECONDARY_ORIGIN = MARKET_HUB_ALLOWED_ORIGINS[0];
export const MARKET_HUB_DEFAULT_PRIMARY_USERS = Object.freeze([
  "gb11",
  "gb12",
  "gb13",
  "gb14",
  "gb15",
]);

const ALLOWED = new Set(MARKET_HUB_ALLOWED_ORIGINS);

/** @param {unknown} raw @returns {string | null} */
export function normalizeMarketHubOrigin(raw) {
  const s = String(raw || "").trim().replace(/\/+$/, "");
  if (!s)
    return null;
  if (ALLOWED.has(s))
    return s;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:")
      return null;
    const origin = `https://${u.hostname}`;
    return ALLOWED.has(origin) ? origin : null;
  }
  catch {
    return null;
  }
}

/** @param {unknown} raw @returns {string[] | null} null = 字段缺失 */
export function parseMarketHubUserList(raw) {
  if (raw == null)
    return null;
  /** @type {string[]} */
  let parts = [];
  if (Array.isArray(raw))
    parts = raw.map(v => String(v ?? ""));
  else if (typeof raw === "string")
    parts = raw.split(/[,;\s]+/);
  else
    return null;
  const seen = new Set();
  const out = [];
  for (const p of parts) {
    const name = p.trim().toLowerCase();
    if (!name || seen.has(name))
      continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

function envUserList() {
  return parseMarketHubUserList(process.env.MARKET_HUB_PRIMARY_USERS);
}

function envOrigin(key, fallback) {
  return normalizeMarketHubOrigin(process.env[key]) || fallback;
}

/**
 * @returns {{
 *   primaryOrigin: string,
 *   secondaryOrigin: string,
 *   primaryUsers: string[],
 *   defaultHub: "primary" | "secondary",
 *   updatedAt?: number,
 * }}
 */
export function getMarketHubRouteConfig() {
  const raw = readJsonFile(FILE, null);
  const hasFile = raw && typeof raw === "object" && !Array.isArray(raw);
  const fileUsers = hasFile ? parseMarketHubUserList(raw.primaryUsers) : null;
  const primaryUsers = fileUsers
    ?? envUserList()
    ?? [...MARKET_HUB_DEFAULT_PRIMARY_USERS];
  const primaryOrigin = (hasFile && normalizeMarketHubOrigin(raw.primaryOrigin))
    || envOrigin("MARKET_HUB_PRIMARY_ORIGIN", MARKET_HUB_DEFAULT_PRIMARY_ORIGIN);
  const secondaryOrigin = (hasFile && normalizeMarketHubOrigin(raw.secondaryOrigin))
    || envOrigin("MARKET_HUB_SECONDARY_ORIGIN", MARKET_HUB_DEFAULT_SECONDARY_ORIGIN);
  const defaultHub = hasFile
    ? (raw.defaultHub === "secondary" ? "secondary" : "primary")
    : "primary";
  const updatedAt = hasFile && Number(raw.updatedAt) > 0
    ? Number(raw.updatedAt)
    : undefined;
  return {
    primaryOrigin,
    secondaryOrigin,
    primaryUsers,
    defaultHub,
    ...(updatedAt != null ? { updatedAt } : {}),
  };
}

/** @param {unknown} userName */
export function resolveMarketHubOriginForUser(userName) {
  const cfg = getMarketHubRouteConfig();
  const name = String(userName || "").trim().toLowerCase();
  if (name && cfg.primaryUsers.includes(name))
    return cfg.primaryOrigin;
  return cfg.defaultHub === "primary" ? cfg.primaryOrigin : cfg.secondaryOrigin;
}

/**
 * @param {{
 *   primaryOrigin?: unknown,
 *   secondaryOrigin?: unknown,
 *   primaryUsers?: unknown,
 *   defaultHub?: unknown,
 * }} input
 */
export function saveMarketHubRouteConfig(input = {}) {
  const primaryOrigin = input.primaryOrigin != null
    ? normalizeMarketHubOrigin(input.primaryOrigin)
    : getMarketHubRouteConfig().primaryOrigin;
  const secondaryOrigin = input.secondaryOrigin != null
    ? normalizeMarketHubOrigin(input.secondaryOrigin)
    : getMarketHubRouteConfig().secondaryOrigin;
  if (!primaryOrigin || !secondaryOrigin)
    throw new Error("非法 Market hub origin（仅允许 ws.changmen.fun）");
  const users = input.primaryUsers !== undefined
    ? parseMarketHubUserList(input.primaryUsers)
    : getMarketHubRouteConfig().primaryUsers;
  if (!users)
    throw new Error("primaryUsers 无效");
  const defaultHub = input.defaultHub === "secondary" ? "secondary" : "primary";
  const next = {
    primaryOrigin,
    secondaryOrigin,
    primaryUsers: users,
    defaultHub,
    updatedAt: Date.now(),
  };
  writeJsonFile(FILE, next);
  return getMarketHubRouteConfig();
}
