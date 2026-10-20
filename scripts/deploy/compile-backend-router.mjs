// Build only the freshly extracted HEAD sources; never copy local generated JS.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { COMPILED_PAIRS, ROUTER_BUILD_FILES, ROUTER_BUILD_MANIFEST, routerBuildHashes,
  verifyPrecompiledRouter } from "../../server/backend/scripts/ensure-router-compiled.mjs";

export function compileBackendRouter(source, repoRoot, timestamp) {
  const backend = path.join(source, "server/backend");
  const compiler = createRequire(path.join(repoRoot, "server/backend/package.json")).resolve("typescript/bin/tsc");
  const modules = path.join(source, "node_modules");
  assert(!fs.existsSync(modules), "Build tree already has dependencies");
  fs.symlinkSync(path.join(repoRoot, "node_modules"), modules, "junction");
  try {
    for (const [, js] of COMPILED_PAIRS) fs.rmSync(path.join(backend, "core/esport-api", js), { force: true });
    execFileSync(process.execPath, [compiler, "-p", "tsconfig.router.json"],
      { cwd: backend, encoding: "utf8", windowsHide: true, stdio: "pipe" });
    const manifest = path.join(source, ROUTER_BUILD_MANIFEST);
    fs.mkdirSync(path.dirname(manifest), { recursive: true });
    fs.writeFileSync(manifest, JSON.stringify({ schemaVersion: 1, hashes: routerBuildHashes(backend) }, null, 2) + "\n");
    const files = [...COMPILED_PAIRS.map(([, js]) => `server/backend/core/esport-api/${js}`), ROUTER_BUILD_MANIFEST];
    // Generated files have the commit timestamp, preserving reproducible tar bytes.
    for (const file of files) fs.utimesSync(path.join(source, file), timestamp, timestamp);
    verifyPrecompiledRouter(source);
    assert(ROUTER_BUILD_FILES.every(file => fs.existsSync(path.join(backend, file))));
    return files;
  } finally { fs.unlinkSync(modules); }
}
