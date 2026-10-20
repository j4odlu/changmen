#!/usr/bin/env node
/**
 * router.js / admin_routes.js / account_client_routes.js / pm_pf_routes.js 由 tsc 编译且不入库；
 * 开发按需编译；生产归档通过源码/配置/生成文件哈希验证预编译路由。
 */
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.join(__dirname, "..");
const ESPORT_API = path.join(BACKEND_ROOT, "core/esport-api");

export const COMPILED_PAIRS = [
  ["router.ts", "router.js"],
  ["admin_routes.ts", "admin_routes.js"],
  ["account_client_routes.ts", "account_client_routes.js"],
  ["pm_pf_routes.ts", "pm_pf_routes.js"],
  ["action_registry.ts", "action_registry.js"],
];

export const ROUTER_BUILD_MANIFEST = "server/backend/output/router-build.json";
export const ROUTER_BUILD_FILES = ["tsconfig.json", "tsconfig.router.json",
  ...COMPILED_PAIRS.flatMap(pair => pair.map(file => `core/esport-api/${file}`))];

export function routerBuildHashes(backendRoot = BACKEND_ROOT) {
  return Object.fromEntries(ROUTER_BUILD_FILES.map(file => [file,
    createHash("sha256").update(fs.readFileSync(path.join(backendRoot, file))).digest("hex")]));
}

// A sealed release verifies source and emitted bytes without loading a compiler.
export function verifyPrecompiledRouter(root = path.resolve(BACKEND_ROOT, "../..")) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, ROUTER_BUILD_MANIFEST), "utf8"));
  assert.equal(manifest.schemaVersion, 1, "Unsupported precompiled router manifest");
  assert.deepEqual(manifest.hashes, routerBuildHashes(path.join(root, "server/backend")), "Precompiled router changed; rebuild the backend artifact");
  return true;
}

function pairIsStale(tsName, jsName) {
  const tsPath = path.join(ESPORT_API, tsName);
  const jsPath = path.join(ESPORT_API, jsName);
  if (!fs.existsSync(tsPath))
    return false;
  return (
    !fs.existsSync(jsPath)
    || fs.statSync(tsPath).mtimeMs > fs.statSync(jsPath).mtimeMs
  );
}

export function routerJsIsStale() {
  return COMPILED_PAIRS.some(([ts, js]) => pairIsStale(ts, js));
}

export function ensureRouterCompiled({ label = "ensure-router" } = {}) {
  const root = path.resolve(BACKEND_ROOT, "../..");
  if (fs.existsSync(path.join(root, ROUTER_BUILD_MANIFEST))) return verifyPrecompiledRouter(root);
  if (!routerJsIsStale())
    return true;

  console.log(`[${label}] esport-api .ts 较新，运行 compile:router …`);
  const r = spawnSync("npm", ["run", "compile:router"], {
    cwd: BACKEND_ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  if (r.status !== 0) {
    process.exit(r.status ?? 1);
  }
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv[2] === "--verify") verifyPrecompiledRouter();
  else ensureRouterCompiled();
}
