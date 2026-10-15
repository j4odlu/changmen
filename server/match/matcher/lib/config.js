/**
 * Matcher 运行时参数（唯一读取 env 的位置）。
 * 改间隔、端口等只改此处与 server/backend/.env.example 说明。
 */

import { DEFAULT_CLIENT_MATCH_ARCHIVE_INTERVAL_MS } from "@changmen/db";

const DEFAULT_MATCHER_INTERVAL_MS = 30_000;
const DEFAULT_UI_PORT = 4567;

export const MATCHER_INTERVAL_MS = Number(
  process.env.MATCHER_INTERVAL_MS || DEFAULT_MATCHER_INTERVAL_MS,
);

export const MATCHER_CLIENT_MATCH_ARCHIVE_INTERVAL_MS = Number(
  process.env.MATCHER_CLIENT_MATCH_ARCHIVE_INTERVAL_MS
  || process.env.MATCHER_PRUNE_INTERVAL_MS
  || DEFAULT_CLIENT_MATCH_ARCHIVE_INTERVAL_MS,
);

export const MATCHER_UI_PORT = Number(
  process.env.MATCHER_UI_PORT || process.env.PIPEI_PORT || DEFAULT_UI_PORT,
);

export { isMatcherSkipAuthEnabled } from "./auth_config.js";

export function isMatcherProduction() {
  return String(process.env.NODE_ENV || "").trim().toLowerCase() === "production";
}

// ── composer（合场）参数 ─────────────────────────────────────────────────────

const DEFAULT_COMPOSER_INTERVAL_MS = 30_000;

export const COMPOSER_INTERVAL_MS = Number(
  process.env.MATCH_COMPOSER_INTERVAL_MS
  || process.env.MATCHER_INTERVAL_MS
  || DEFAULT_COMPOSER_INTERVAL_MS,
);

export const COMPOSER_ARCHIVE_INTERVAL_MS = Number(
  process.env.MATCH_COMPOSER_ARCHIVE_INTERVAL_MS
  || process.env.MATCHER_CLIENT_MATCH_ARCHIVE_INTERVAL_MS
  || DEFAULT_CLIENT_MATCH_ARCHIVE_INTERVAL_MS,
);

/** 1 = 写 client_matches；默认 dry-run */
export function isComposerWriteEnabled() {
  return String(process.env.MATCH_COMPOSER_WRITE || "").trim() === "1";
}

export function isComposerStickyOrientation() {
  // 兼容运维已设的 MATCH_PROJECTOR_STICKY_ORIENTATION
  const v = process.env.MATCH_COMPOSER_STICKY_ORIENTATION
    || process.env.MATCH_PROJECTOR_STICKY_ORIENTATION
    || "";
  return String(v).trim() === "1";
}

export function isComposerForceReanchor() {
  const v = process.env.MATCH_COMPOSER_REANCHOR
    || process.env.MATCH_PROJECTOR_REANCHOR
    || "";
  return String(v).trim() === "1";
}

/**
 * PB 同 rotNum 多 event 认一场 + B1 sibling 地图盘拼进 Sources（默认开）。
 * 回滚：COMPOSER_PB_ROTNUM_COLLAPSE=0
 * [changmen 扩展] Matchs.PB 仍为主 event.id；下注 ID 在 Sources.HomeID/BetID。
 */
export function isComposerPbRotnumCollapse() {
  return String(process.env.COMPOSER_PB_ROTNUM_COLLAPSE ?? "1").trim() !== "0";
}
