import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { backendArchiveIncludes, packBackendRepoArchive } from "./pack-git-repo.mjs";
import { readSourceVersion } from "../../devtools/runtime-tooling/runtime_version.js";
import { routerArtifactFixture } from "./fixtures/router-artifact.mjs";
import { COMPILED_PAIRS, ROUTER_BUILD_MANIFEST, verifyPrecompiledRouter } from "../../server/backend/scripts/ensure-router-compiled.mjs";

test("HEAD-only backend artifacts exclude browser code and tests, retain assets and manifests, and reproduce exactly", t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "changmen-archive-test-"));
  t.after(() => {
    assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
    assert(path.basename(temporary).startsWith("changmen-archive-test-"));
    fs.rmSync(temporary, { recursive: true, force: true });
  });
  const root = path.join(temporary, "repo"), extracted = path.join(temporary, "extracted"); fs.mkdirSync(root); fs.mkdirSync(extracted);
  const write = (file, value) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), value); };
  const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "pipe", encoding: "utf8" });
  const kept = { ...routerArtifactFixture(root), "package.json": '{"type":"module"}', "package-lock.json": "{}",
    "client/web/package.json": '{"name":"web"}', "client/packages/venue-browser/package.json": '{"name":"browser"}',
    "server/backend/package.json": '{"name":"backend"}', "server/backend/start.js": "export const live = 1;",
    "server/backend/scripts/ensure-router-compiled.mjs": fs.readFileSync(new URL("../../server/backend/scripts/ensure-router-compiled.mjs", import.meta.url), "utf8").replaceAll("\r\n", "\n"),
    "server/backend/public/icon.svg": "<svg/>", "server/backend/空 格.js": "export const value = 1;",
    "server/venues/registry/runtime/provider.json": '{"loader":"resource"}',
    "rds/assets/migrations/001.sql": "CREATE TABLE example(id int);", "rds/maintenance/check.mjs": "export {};",
    "packages/shared/rules.js": "export const rule = 1;", "packages/api-contract/package.json": '{"version":"1"}',
    "packages/match-identity/index.ts": 'export const identity = "one";',
    "packages/match-identity/teams/team_aliases.json": '{"alias":"team"}',
    "packages/api-contract/action.ts": 'export const action = "one";', "deploy/ecosystem.config.cjs": "module.exports={};",
    "scripts/deploy/install-backend.mjs": "export {};" };
  const omitted = ["client/web/src/App.vue", "client/packages/venue-browser/adapter.js", "packages/client-core/old.js",
    "docs/large.json", "scripts/testing/fixture.mjs", "server/backend/tests/fixture.json", "server/backend/start.test.mjs",
    "server/backend/README.md", "server/backend/.env", "server/backend/storage/accounts.json", "rds/.env.local", "rds/private.key"];
  for (const [file, value] of Object.entries(kept)) write(file, value);
  for (const file of omitted) write(file, "must not ship");
  git("init", "-q"); git("add", "."); git("-c", "user.name=Artifact", "-c", "user.email=artifact@example.invalid", "commit", "-qm", "fixture");
  assert.equal(git("ls-files", "node_modules"), "", "Dependency links must not enter the Git archive on Linux or Windows");
  const before = readSourceVersion(root, "backend"), a = path.join(temporary, "a.tgz"), b = path.join(temporary, "b.tgz");
  const packed = packBackendRepoArchive(root, a);
  write("server/backend/start.js", "uncommitted change"); write("server/backend/untracked.js", "untracked");
  write("server/backend/core/esport-api/router.ts", "invalid local TypeScript");
  write("server/backend/core/esport-api/router.js", "poisoned local output");
  packBackendRepoArchive(root, b);
  assert(fs.readFileSync(a).equals(fs.readFileSync(b)), "Archive changes across identical committed inputs");
  const gnu = process.platform === "win32" ? "C:/msys64/usr/bin/tar.exe" : "tar";
  execFileSync(gnu, [...(process.platform === "win32" ? ["--force-local"] : []), "-xzf", a, "-C", extracted]);
  for (const [file, value] of Object.entries(kept)) assert.equal(fs.readFileSync(path.join(extracted, file), "utf8").replaceAll("\r\n", "\n"), value);
  for (const file of [...omitted, "server/backend/untracked.js"]) assert(!fs.existsSync(path.join(extracted, file)), file);
  assert.equal(packed.files, Object.keys(kept).length + COMPILED_PAIRS.length + 1);
  verifyPrecompiledRouter(extracted);
  // Tar extraction timestamps must never cause a production rebuild.
  fs.utimesSync(path.join(extracted, "server/backend/core/esport-api/router.ts"), new Date(), new Date(Date.now() + 60000));
  execFileSync(process.execPath, ["server/backend/scripts/ensure-router-compiled.mjs"], { cwd: extracted });
  for (const file of ["server/backend/core/esport-api/router.ts", "server/backend/tsconfig.router.json"]) {
    const target = path.join(extracted, file), original = fs.readFileSync(target);
    fs.appendFileSync(target, "\n// changed");
    assert.throws(() => verifyPrecompiledRouter(extracted), /Precompiled router changed/);
    fs.writeFileSync(target, original);
  }
  const generated = path.join(extracted, "server/backend/core/esport-api/router.js");
  assert.match(fs.readFileSync(generated, "utf8"), /value = 42/);
  fs.appendFileSync(generated, "\n// changed");
  assert.throws(() => verifyPrecompiledRouter(extracted), /Precompiled router changed/);
  assert(fs.existsSync(path.join(extracted, ROUTER_BUILD_MANIFEST)));
  assert.equal(readSourceVersion(extracted, "backend").sourceFingerprint, before.sourceFingerprint);
  assert.equal(readSourceVersion(extracted, "backend").contractFingerprint, before.contractFingerprint);
  fs.unlinkSync(path.join(extracted, "server/venues/registry/runtime/provider.json"));
  assert.notEqual(readSourceVersion(extracted, "backend").sourceFingerprint, before.sourceFingerprint);
  // Compiler errors cannot leave a publishable archive behind.
  git("add", "server/backend/core/esport-api/router.ts");
  git("-c", "user.name=Artifact", "-c", "user.email=artifact@example.invalid", "commit", "-qm", "invalid source");
  assert.throws(() => packBackendRepoArchive(root, b));
  assert(!fs.existsSync(b));
});

test("archive selection rejects unsafe paths", () => {
  for (const file of ["../server/file.js", "/server/file.js", "server/../file.js", "C:/file.js", "server\\file.js", "server//file.js", "server/\0file.js"])
    assert.throws(() => backendArchiveIncludes(file), /Unsafe/);
});
