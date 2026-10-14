import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { recordRelease, pruneReleases, prepareFrontendAssets } from "./release-retention.mjs";
const noProcesses = { running: () => [] };
const link = (target, name) => fs.symlinkSync(target, name, process.platform === "win32" ? "junction" : "dir");
function fixture(scope) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "release-retention-"));
  const base = path.join(repo, ".releases", scope);
  fs.mkdirSync(base, { recursive: true }); fs.mkdirSync(path.join(repo, ".deploy-state"));
  fs.mkdirSync(path.join(repo, "client/web"), { recursive: true });
  const pointer = path.join(repo, scope === "backend" ? "backend-current" : "client/web/dist");
  const version = name => { const target = path.join(base, `${scope}-${name}`); fs.mkdirSync(target); return target; };
  const activate = target => { if (fs.existsSync(pointer)) fs.unlinkSync(pointer); link(target, pointer); };
  return { repo, base, pointer, version, activate, state: path.join(repo, ".deploy-state", `${scope}-retained.json`) };
}
for (const scope of ["backend", "frontend"]) test(`${scope} keeps only current and previous success, removes failed candidates, and preserves shared data`, () => {
  const f = fixture(scope);
  try {
    const a = f.version("a"); f.activate(a); recordRelease(f.repo, scope, a, null, noProcesses);
    const b = f.version("b"); f.activate(b); recordRelease(f.repo, scope, b, a, noProcesses);
    const shared = path.join(f.repo, "shared-data"); fs.mkdirSync(shared); fs.writeFileSync(path.join(shared, "ledger"), "keep");
    link(shared, path.join(a, "storage"));
    const failed = f.version("failed");
    const c = f.version("c"); f.activate(c);
    const result = recordRelease(f.repo, scope, c, b, noProcesses);
    assert.deepEqual(result.removed.sort(), [a, failed].sort());
    assert.deepEqual(fs.readdirSync(f.base).sort(), [`${scope}-b`, `${scope}-c`]);
    assert.equal(fs.readFileSync(path.join(shared, "ledger"), "utf8"), "keep");
    recordRelease(f.repo, scope, c, c, noProcesses);
    assert.equal(JSON.parse(fs.readFileSync(f.state)).previous, b, "Repeating success retains the rollback version");
  } finally { fs.rmSync(f.repo, { recursive: true, force: true }); }
});
test("first adoption does not guess old success from directory timestamps", () => {
  const f = fixture("backend");
  try {
    f.version("unknown");
    assert.equal(pruneReleases(f.repo, "backend", noProcesses).initialized, false);
    assert(fs.existsSync(path.join(f.base, "backend-unknown")));
  } finally { fs.rmSync(f.repo, { recursive: true, force: true }); }
});
test("cleanup refuses changed current identity and paths outside the release root", () => {
  const f = fixture("backend");
  try {
    const a = f.version("a"); f.activate(a); recordRelease(f.repo, "backend", a, null, noProcesses);
    const b = f.version("b"); f.activate(b);
    assert.throws(() => pruneReleases(f.repo, "backend", noProcesses), /Current release changed/);
    assert(fs.existsSync(a));
    f.activate(a); const state = JSON.parse(fs.readFileSync(f.state)); state.previous = os.tmpdir();
    fs.writeFileSync(f.state, JSON.stringify(state));
    assert.throws(() => pruneReleases(f.repo, "backend", noProcesses), /outside managed root/);
    assert(fs.existsSync(b));
  } finally { fs.rmSync(f.repo, { recursive: true, force: true }); }
});
test("live processes, foreign directories and symlinks are never removed", () => {
  const f = fixture("backend");
  try {
    const a = f.version("a"), b = f.version("b"), busy = f.version("busy");
    f.activate(a); recordRelease(f.repo, "backend", a, null, { running: () => [busy] });
    // b was an unused candidate and was reclaimed; recreate it as the next successful release.
    fs.mkdirSync(b); f.activate(b);
    const foreign = path.join(f.base, "notes"); fs.mkdirSync(foreign);
    const outside = path.join(f.repo, "outside"); fs.mkdirSync(outside);
    link(outside, path.join(f.base, "backend-link"));
    const result = recordRelease(f.repo, "backend", b, a, { running: () => [path.join(busy, "server/main.js")] });
    assert.deepEqual(result.skipped, [busy]); assert(fs.existsSync(busy));
    assert(fs.existsSync(foreign)); assert(fs.existsSync(outside)); assert(fs.existsSync(path.join(f.base, "backend-link")));
  } finally { fs.rmSync(f.repo, { recursive: true, force: true }); }
});
test("frontend copies previous own chunks without passing older generations forward", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "release-assets-"));
  const build = name => {
    const folder = path.join(root, name); fs.mkdirSync(path.join(folder, "assets"), { recursive: true });
    fs.writeFileSync(path.join(folder, "index.html"), `<script src="assets/${name}.js"></script>`);
    fs.writeFileSync(path.join(folder, "assets", `${name}.js`), `import('${name}-nested.js')`);
    fs.writeFileSync(path.join(folder, "assets", `${name}-nested.js`), "code"); return folder;
  };
  try {
    const a = build("a"); fs.writeFileSync(path.join(a, "assets", "historical.js"), "unused");
    const b = build("b"); prepareFrontendAssets(b, a);
    assert(fs.existsSync(path.join(b, "assets/a-nested.js"))); assert(!fs.existsSync(path.join(b, "assets/historical.js")));
    const c = build("c"); prepareFrontendAssets(c, b);
    assert(fs.existsSync(path.join(c, "assets/b-nested.js"))); assert(!fs.existsSync(path.join(c, "assets/a.js")));
    const before = fs.readFileSync(path.join(c, "assets/c.js"));
    fs.writeFileSync(path.join(b, ".release-assets.json"), JSON.stringify(["assets/../../outside"]));
    assert.throws(() => prepareFrontendAssets(c, b), /Invalid previous asset inventory/);
    assert.deepEqual(fs.readFileSync(path.join(c, "assets/c.js")), before);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
