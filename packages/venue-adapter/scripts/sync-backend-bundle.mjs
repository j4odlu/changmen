#!/usr/bin/env node
/**
 * 将 packages/venue-adapter 同步到 server/backend/platform_adapter（瘦包；不含 platform-probes）。
 * 仅用于「瘦包」部署（无 changmen/packages 目录）；标准 monorepo VPS 部署不需要。
 *
 * 各平台目录只同步基础设施；采集/下注 ts 与 `{platform}/shared/` 留在客户端，不进瘦包。
 *
 * 用法：
 *   npm run sync:backend-bundle --workspace=@changmen/venue-adapter
 *   npm run sync:platform-adapter --workspace=@changmen/backend
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BACKEND_ROOT } from "@changmen/storage/paths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADAPTER_PKG_ROOT = path.join(__dirname, "..");

const ADAPTER_INFRA = new Set([
  "registry",
  "loader",
  "shared",
  "contract",
  "scripts",
  "_template",
  "node_modules",
]);

function cpDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (name === "_template") continue;
    const from = path.join(src, name);
    const to = path.join(dst, name);
    if (fs.statSync(from).isDirectory()) cpDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

/**
 * @param {{ dst?: string, src?: string, includeBrowserSources?: boolean }} [options]
 * @returns {string} 目标目录绝对路径
 */
export function syncPlatformAdapterBackendBundle(options = {}) {
  const src = options.src ?? ADAPTER_PKG_ROOT;
  const dst = options.dst ?? path.join(BACKEND_ROOT, "platform_adapter");

  if (!fs.existsSync(path.join(src, "registry", "manifest.json"))) {
    throw new Error(`platform-adapter source missing manifest: ${src}`);
  }

  if (fs.existsSync(dst)) {
    fs.rmSync(dst, { recursive: true, force: true });
  }
  fs.mkdirSync(dst, { recursive: true });

  for (const name of fs.readdirSync(src)) {
    if (name === "_template") continue;
    const from = path.join(src, name);
    const to = path.join(dst, name);
    if (!fs.statSync(from).isDirectory()) {
      fs.copyFileSync(from, to);
      continue;
    }
    if (!ADAPTER_INFRA.has(name)) {
      if (options.includeBrowserSources) cpDir(from, to);
      continue;
    }
    cpDir(from, to);
  }

  // Materialize the three legacy Node entries when packaging workspace facades.
  for (const [relative, canonical] of Object.entries({
    "loader/adapter_paths.mjs": "server/packages/venue-node-loader/adapter_paths.mjs",
    "registry/paths.js": "server/packages/venue-node-registry/paths.js",
    "registry/feeds.js": "server/packages/venue-node-registry/feeds.js",
  })) {
    const originalPath = path.join(src, relative);
    if (!fs.existsSync(originalPath)) continue;
    const facade = fs.readFileSync(originalPath, "utf8").replaceAll("\r\n", "\n");
    const expected = `export * from "../../../${canonical}";\n`;
    if (facade !== expected) continue;
    const implementation = path.resolve(path.dirname(originalPath), "../../../", canonical);
    const anchor = `new URL("../../../packages/venue-adapter/${relative}", import.meta.url)`;
    const source = fs.readFileSync(implementation, "utf8").replaceAll(anchor, "import.meta.url");
    fs.writeFileSync(path.join(dst, relative), source);
  }

  return dst;
}

const isMain =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  const dst = syncPlatformAdapterBackendBundle();
  console.log(`[sync-platform-adapter] ${dst}`);
}
