#!/usr/bin/env node
/**
 * 将可选探针工具同步到 server/backend/platform_node；后端运行资源由 venue-node 单独交付。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BACKEND_ROOT } from "@changmen/storage/paths";

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

  if (!fs.existsSync(path.join(src, "ob", "scripts", "fetch_ob_login.js"))) {
    throw new Error(`platform-probes source missing ob/scripts/fetch_ob_login.js: ${src}`);
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
