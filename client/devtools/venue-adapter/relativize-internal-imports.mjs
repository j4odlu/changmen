#!/usr/bin/env node
/**
 * 将 packages/venue-adapter 包内 @changmen/venue-adapter/* 自引用改为相对路径。
 * 不修改 client/web、scripts、README。
 *
 * 用法：
 *   node packages/venue-adapter/scripts/relativize-internal-imports.mjs
 *   node packages/venue-adapter/scripts/relativize-internal-imports.mjs --check
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADAPTER_ROOT = path.resolve(__dirname, "../../../packages/venue-adapter");
const PKG = "@changmen/venue-adapter";
const CHECK = process.argv.includes("--check");

const SKIP_DIRS = new Set(["node_modules", "dist", "scripts"]);

function replaceImports(text, file, onHit) {
  let out = text;
  for (const spec of IMPORT_SPECS) {
    spec.re.lastIndex = 0;
    out = out.replace(spec.re, (...args) => {
      const groups = args.slice(1, 1 + spec.groups);
      const sub = groups[spec.subIndex];
      const rel = toRelativeImport(file, sub);
      onHit();
      return spec.build(groups, rel);
    });
  }
  return out;
}

const IMPORT_SPECS = [
  {
    groups: 2,
    subIndex: 1,
    re: new RegExp(`((?:from|import)\\s+(?:type\\s+)?[\\s\\S]+?\\s+from\\s+)["']${PKG}/([^"']+)["']`, "g"),
    build: ([prefix], rel) => `${prefix}"${rel}"`,
  },
  {
    groups: 3,
    subIndex: 1,
    re: new RegExp(`(import\\s*\\(\\s*)["']${PKG}/([^"']+)["'](\\s*\\))`, "g"),
    build: ([prefix, , suffix], rel) => `${prefix}"${rel}"${suffix}`,
  },
  {
    groups: 2,
    subIndex: 1,
    re: new RegExp(`(export\\s+[\\s\\S]+?\\s+from\\s+)["']${PKG}/([^"']+)["']`, "g"),
    build: ([prefix], rel) => `${prefix}"${rel}"`,
  },
];

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP_DIRS.has(name))
      continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory())
      walk(p, out);
    else if (/\.(ts|tsx)$/.test(name))
      out.push(p);
  }
  return out;
}

function resolveTargetAbs(sub) {
  const rel = sub.replace(/\\/g, "/");
  const candidates = [
    path.join(ADAPTER_ROOT, `${rel}.ts`),
    path.join(ADAPTER_ROOT, `${rel}.tsx`),
    path.join(ADAPTER_ROOT, rel, "index.ts"),
    path.join(ADAPTER_ROOT, rel, "index.tsx"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c))
      return c;
  }
  return null;
}

function toRelativeImport(fromFile, sub) {
  const targetAbs = resolveTargetAbs(sub);
  if (!targetAbs) {
    throw new Error(`无法解析 ${PKG}/${sub}（来自 ${path.relative(ADAPTER_ROOT, fromFile)}）`);
  }
  const fromDir = path.dirname(fromFile);
  let rel = path.relative(fromDir, targetAbs).replace(/\\/g, "/");
  rel = rel.replace(/\.tsx?$/, "");
  if (rel.endsWith("/index"))
    rel = rel.slice(0, -"/index".length);
  if (!rel.startsWith("."))
    rel = `./${rel}`;
  return rel;
}

function transformFile(file) {
  const original = fs.readFileSync(file, "utf8");
  let hits = 0;
  const next = replaceImports(original, file, () => { hits++; });
  return { original, next, changed: hits > 0 };
}

let changedFiles = 0;
for (const file of walk(ADAPTER_ROOT)) {
  const { original, next, changed } = transformFile(file);
  if (!changed)
    continue;
  changedFiles++;
  if (CHECK) {
    console.error(`relativize --check: 仍含包内自引用: ${path.relative(ADAPTER_ROOT, file)}`);
    continue;
  }
  fs.writeFileSync(file, next);
}

if (CHECK) {
  if (changedFiles) {
    console.error(`relativize --check: ${changedFiles} 个文件待改写，运行脚本无 --check`);
    process.exit(1);
  }
  console.log("relativize --check: OK");
  process.exit(0);
}

console.log(`relativize-internal-imports: updated ${changedFiles} files`);
