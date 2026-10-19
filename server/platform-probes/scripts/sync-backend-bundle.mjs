#!/usr/bin/env node
/**
 * 将 devtools/platform-probes 同步到 server/backend/platform_node（瘦包部署）。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BACKEND_ROOT } from "@changmen/storage/paths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NODE_PKG_ROOT = path.join(__dirname, "..");

function cpDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (name === "node_modules") continue;
    const from = path.join(src, name);
    const to = path.join(dst, name);
    if (fs.statSync(from).isDirectory()) cpDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

/**
 * @param {{ dst?: string, src?: string }} [options]
 * @returns {string}
 */
export function syncPlatformNodeBundle(options = {}) {
  const src = options.src ?? NODE_PKG_ROOT;
  const dst = options.dst ?? path.join(BACKEND_ROOT, "platform_node");

  if (!fs.existsSync(path.join(src, "ob", "session.js"))) {
    throw new Error(`platform-probes source missing ob/session.js: ${src}`);
  }

  if (fs.existsSync(dst)) {
    fs.rmSync(dst, { recursive: true, force: true });
  }
  cpDir(src, dst);
  return dst;
}

const isMain =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  const dst = syncPlatformNodeBundle();
  console.log(`[sync-platform-probes] ${dst}`);
}
