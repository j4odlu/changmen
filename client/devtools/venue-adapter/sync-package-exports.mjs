#!/usr/bin/env node
/**
 * 从 monorepo 内 @changmen/venue-adapter/* 引用生成 package.json exports 白名单。
 * 扫描：client/web/src、packages/venue-adapter（含 vi.mock / dynamic import）。
 *
 * 用法：
 *   node packages/venue-adapter/scripts/sync-package-exports.mjs          # 写回 package.json
 *   node packages/venue-adapter/scripts/sync-package-exports.mjs --check  # 仅校验，有漂移 exit 1
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const ADAPTER_ROOT = path.resolve(__dirname, "../../../packages/venue-adapter");
const PKG_JSON = path.join(ADAPTER_ROOT, "package.json");
const PKG = "@changmen/venue-adapter";
const CHECK = process.argv.includes("--check");

const SCAN_ROOTS = [
  path.join(REPO_ROOT, "client", "web", "src"),
  ADAPTER_ROOT,
];

const IMPORT_RES = [
  new RegExp(`(?:from|import)\\s*(?:\\(?\\s*)?["']${PKG}/([^"']+)["']`, "g"),
  new RegExp(`import\\s*\\(\\s*["']${PKG}/([^"']+)["']\\s*\\)`, "g"),
  new RegExp(`vi\\.mock\\s*\\(\\s*["']${PKG}/([^"']+)["']`, "g"),
];

/** 固定公共入口；旧浏览器入口不能因应用改用新包而被扫描器删除。 */
const FIXED_EXPORTS = {
  ".": "./registry/index.ts",
  "./loader/adapter_paths.js": "./loader/adapter_paths.mjs",
  "./loader/adapter_paths.mjs": "./loader/adapter_paths.mjs",
  "./polymarket/orderBook": "./polymarket/orderBook.ts",
  "./polymarket/wsBookShadow": "./polymarket/wsBookShadow.ts",
};

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === "node_modules" || name === "dist")
      continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory())
      walk(p, out);
    else if (/\.(ts|tsx|vue|mjs|js)$/.test(name))
      out.push(p);
  }
  return out;
}

function resolveExportTarget(sub) {
  const rel = sub.replace(/\\/g, "/");
  const candidates = [
    `${rel}.ts`,
    `${rel}.tsx`,
    `${rel}/index.ts`,
    `${rel}.mjs`,
    `${rel}/index.mjs`,
  ];
  for (const c of candidates) {
    const abs = path.join(ADAPTER_ROOT, c);
    if (fs.existsSync(abs))
      return `./${c}`;
  }
  return null;
}

function collectSubpaths() {
  const subs = new Set();
  for (const root of SCAN_ROOTS) {
    if (!fs.existsSync(root))
      continue;
    for (const file of walk(root)) {
      const text = fs.readFileSync(file, "utf8");
      for (const re of IMPORT_RES) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text)) !== null)
          subs.add(m[1]);
      }
    }
  }
  return subs;
}

function buildExports() {
  const exports = { ...FIXED_EXPORTS };
  const missing = [];
  for (const sub of [...collectSubpaths()].sort()) {
    const target = resolveExportTarget(sub);
    if (!target) {
      missing.push(sub);
      continue;
    }
    exports[`./${sub}`] = target;
  }
  if (missing.length) {
    console.error("sync-package-exports: 无法解析以下子路径到磁盘文件：");
    for (const m of missing)
      console.error(`  ./${m}`);
    process.exit(1);
  }
  return exports;
}

function sortedExportsObject(exports) {
  const out = {};
  for (const key of Object.keys(exports).sort())
    out[key] = exports[key];
  return out;
}

function readCurrentExports() {
  const pkg = JSON.parse(fs.readFileSync(PKG_JSON, "utf8"));
  return pkg.exports ?? {};
}

function exportsEqual(a, b) {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.length !== kb.length)
    return false;
  return ka.every((k, i) => k === kb[i] && a[k] === b[k]);
}

const nextExports = sortedExportsObject(buildExports());

if (CHECK) {
  const cur = readCurrentExports();
  if (!exportsEqual(cur, nextExports)) {
    console.error("sync-package-exports --check: package.json exports 与扫描结果不一致");
    console.error("运行: npm run sync:exports --workspace=@changmen/venue-adapter");
    process.exit(1);
  }
  console.log(`sync-package-exports --check: OK (${Object.keys(nextExports).length} entries)`);
  process.exit(0);
}

const pkg = JSON.parse(fs.readFileSync(PKG_JSON, "utf8"));
pkg.exports = nextExports;
fs.writeFileSync(PKG_JSON, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`sync-package-exports: wrote ${Object.keys(nextExports).length} exports to package.json`);
