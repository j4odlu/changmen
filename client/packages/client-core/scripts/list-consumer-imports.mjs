#!/usr/bin/env node
/**
 * 扫描 client/web + venue-browser 对 @changmen/client-core/* 的引用。
 *
 * 用法：
 *   node client/packages/client-core/scripts/list-consumer-imports.mjs
 *   node client/packages/client-core/scripts/list-consumer-imports.mjs --check
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..");
const PKG = "@changmen/client-core";
const CHECK = process.argv.includes("--check");

const SCAN_ROOTS = [
  { label: "client/web/src", dir: path.resolve(PKG_ROOT, "../../web/src") },
  { label: "client/packages/venue-browser", dir: path.resolve(PKG_ROOT, "../venue-browser") },
];

const IMPORT_RES = [
  new RegExp(`(?:from|import)\\s*(?:\\(?\\s*)?["']${PKG}/([^"']+)["']`, "g"),
  new RegExp(`import\\s*\\(\\s*["']${PKG}/([^"']+)["']\\s*\\)`, "g"),
  new RegExp(`vi\\.mock\\s*\\(\\s*["']${PKG}/([^"']+)["']`, "g"),
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir))
    return out;
  for (const name of fs.readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === "scripts")
      continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory())
      walk(p, out);
    else if (/\.(ts|tsx|vue)$/.test(name))
      out.push(p);
  }
  return out;
}

const subs = new Set();
for (const { dir } of SCAN_ROOTS) {
  for (const file of walk(dir)) {
    const text = fs.readFileSync(file, "utf8");
    for (const re of IMPORT_RES) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text)) !== null)
        subs.add(m[1]);
    }
  }
}

const sorted = [...subs].sort();
const tops = new Set(sorted.map(s => s.split("/")[0]));

console.log(`@changmen/client-core subpaths from consumers (${sorted.length}, ${tops.size} top-level):`);
for (const s of sorted)
  console.log(`  ./${s}`);

if (CHECK) {
  const pkg = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, "package.json"), "utf8"));
  const exports = Object.keys(pkg.exports ?? {}).map(k => k.replace(/^\.\//, ""));
  const missing = sorted.filter(s => !exports.includes(s));
  if (missing.length) {
    console.error("list-consumer-imports --check: 以下子路径未在 package.json exports 中：");
    for (const m of missing)
      console.error(`  ./${m}`);
    console.error("运行: npm run sync:exports --workspace=@changmen/client-core");
    process.exit(1);
  }
  console.log("list-consumer-imports --check: OK");
}
