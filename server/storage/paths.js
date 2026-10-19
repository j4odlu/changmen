import fs from "node:fs";
import path from "node:path";
import { CHANGMEN_ROOT_FROM_PKG, findChangmenRoot } from "./changmen_root.js";

export { findChangmenRoot };

export const CHANGMEN_ROOT = CHANGMEN_ROOT_FROM_PKG;

/**
 * Monorepo 目录布局（相对 CHANGMEN_ROOT 的 POSIX 路径）。
 * 物理搬家时优先只改此处与 docs/PATH_REGISTRY.md；消费方应 import 本模块而非硬编码字符串。
 */
export const CHANGMEN_LAYOUT = {
  venueAdapter: "server/packages/venue-node-registry/runtime",
  clientWeb: "client/web",
  clientChromeExtension: "chrome-extension",
  platformProbes: "server/platform-probes",
  packages: "packages",
  serverBackend: "server/backend",
  serverMatcher: "server/match/matcher",
  serverDb: "server/db",
  serverCollectors: "server/collectors",
  lines: "lines",
  baseball: "baseball",
};

/** @deprecated 使用 CHANGMEN_LAYOUT.venueAdapter */
export const VENUE_ADAPTER_REL = CHANGMEN_LAYOUT.venueAdapter;

export const VENUE_ADAPTER_ROOT = path.join(CHANGMEN_ROOT, CHANGMEN_LAYOUT.venueAdapter);
export const CLIENT_WEB_ROOT = path.join(CHANGMEN_ROOT, CHANGMEN_LAYOUT.clientWeb);
export const PLATFORM_PROBES_ROOT = path.join(CHANGMEN_ROOT, CHANGMEN_LAYOUT.platformProbes);

/** 将 layout 相对段解析为绝对路径 */
export function changmenPath(...relSegments) {
  return path.join(CHANGMEN_ROOT, ...relSegments);
}

export const BACKEND_ROOT =
  process.env.CHANGMEN_BACKEND_ROOT
  || process.env.GAMEBET_BACKEND_ROOT
  || path.join(CHANGMEN_ROOT, "server", "backend");

export const STORAGE_DIR =
  process.env.CHANGMEN_STORAGE_DIR
  || process.env.GAMEBET_STORAGE_DIR
  || path.join(BACKEND_ROOT, "storage");

export const ESPORT_DATA_DIR = process.env.ESPORT_DATA_DIR || STORAGE_DIR;

export function ensureStoragePaths() {
  fs.mkdirSync(ESPORT_DATA_DIR, { recursive: true });
}

ensureStoragePaths();
