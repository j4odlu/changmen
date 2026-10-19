"use strict";

/**
 * CJS 探针路径桥（devtools/platform-probes 仍为 commonjs）。
 * ESM 侧用 _paths.js → @changmen/db/paths.js；此处自包含，避免 CJS require ESM。
 */
const fs = require("node:fs");
const path = require("node:path");

function findChangmenRoot(fromDir) {
  let cur = fromDir;
  for (let i = 0; i < 12; i++) {
    const backendPkg = path.join(cur, "server/backend/package.json");
    if (fs.existsSync(backendPkg)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(backendPkg, "utf8"));
        if (pkg.name === "@changmen/backend") return cur;
      } catch {
        /* ignore */
      }
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return path.resolve(fromDir, "..", "..", "..");
}

const CHANGMEN_ROOT = findChangmenRoot(__dirname);
const BACKEND_ROOT =
  process.env.CHANGMEN_BACKEND_ROOT
  || process.env.GAMEBET_BACKEND_ROOT
  || path.join(CHANGMEN_ROOT, "server", "backend");
const STORAGE_DIR =
  process.env.CHANGMEN_STORAGE_DIR
  || process.env.GAMEBET_STORAGE_DIR
  || path.join(BACKEND_ROOT, "storage");
const ESPORT_DATA_DIR = process.env.ESPORT_DATA_DIR || STORAGE_DIR;

const RESOLVE_PATHS = [
  path.join(BACKEND_ROOT, "node_modules"),
  path.join(CHANGMEN_ROOT, "node_modules"),
];

function reqS(...segments) {
  const entry = `@changmen/shared/${segments.join("/")}`;
  return require(require.resolve(entry, { paths: RESOLVE_PATHS }));
}

function backendRequire(specifier) {
  return require(require.resolve(specifier, { paths: RESOLVE_PATHS }));
}

module.exports = {
  CHANGMEN_ROOT,
  BACKEND_ROOT,
  STORAGE_DIR,
  ESPORT_DATA_DIR,
  reqS,
  backendRequire,
};
