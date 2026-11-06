/**
 * 生产 build：提高 Node 堆上限，避免 VPS 上 vue-tsc -b OOM（默认 ~512–800MB）。
 * 可通过 NODE_HEAP_MB 覆盖，例如 NODE_HEAP_MB=4096 npm run build
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { assembleFrontend } from "../vite/assembleFrontend.mjs";

const webDir = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const heapMb = Math.max(1024, Number(process.env.NODE_HEAP_MB) || 2048);
const nodeArgs = [`--max-old-space-size=${heapMb}`];

/** @param {string} pkg @param {string} relBin */
function resolvePkgBin(pkg, relBin) {
  for (const root of [join(webDir, "node_modules"), join(webDir, "../../node_modules")]) {
    const script = join(root, pkg, relBin);
    if (existsSync(script))
      return script;
  }
  throw new Error(`[build] cannot find ${pkg}/${relBin}`);
}

/** @param {string} script @param {string[]} args */
function runNodeScript(script, args = []) {
  const result = spawnSync(process.execPath, [...nodeArgs, script, ...args], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error)
    throw result.error;
  if (result.status !== 0)
    process.exit(result.status ?? 1);
}

const vueTsc = resolvePkgBin("vue-tsc", "bin/vue-tsc.js");
const viteBin = resolvePkgBin("vite", "bin/vite.js");

console.log(`[build] node heap limit ${heapMb} MB`);
runNodeScript(vueTsc, ["-b"]);

const viteArgs = process.argv.slice(2);
runNodeScript(viteBin, viteArgs.length ? viteArgs : ["build", "--base=/"]);

const listener = join(webDir, "../listener");
runNodeScript(vueTsc, ["--noEmit", "-p", join(listener, "build/tsconfig.live.json")]);
runNodeScript(vueTsc, ["--noEmit", "-p", join(listener, "build/tsconfig.node.json")]);
runNodeScript(viteBin, ["build", "--config", join(listener, "build/vite.production.config.ts"), "--mode", "production"]);
assembleFrontend(join(webDir, "dist"), join(listener, "build/dist"));
console.log("[build] assembled / and /listener/ in the same frontend release");
