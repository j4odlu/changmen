import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installBackend, verifyBackendInstallation } from "./install-backend.mjs";
import { backendInstallProfile } from "./backend-install-profile.mjs";
import { readInstallWorkspaces } from "../verification/component-install-inputs.mjs";
import { routerArtifactFixture } from "./fixtures/router-artifact.mjs";
import { ROUTER_BUILD_MANIFEST, routerBuildHashes } from "../../server/backend/scripts/ensure-router-compiled.mjs";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "changmen-install-command-"));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert(path.basename(root).startsWith("changmen-install-command-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const copy = file => { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(file, target); };
  for (const file of ["package.json", "package-lock.json", "deploy/ecosystem.config.cjs",
    ...[...readInstallWorkspaces(process.cwd()).values()].map(item => item.dir + "/package.json")]) copy(file);
  const packages = readInstallWorkspaces(root);
  routerArtifactFixture(root);
  fs.unlinkSync(path.join(root, "node_modules"));
  for (const name of ["router", "admin_routes", "account_client_routes", "pm_pf_routes", "action_registry"])
    fs.writeFileSync(path.join(root, `server/backend/core/esport-api/${name}.js`), "export const value = 42;\n");
  fs.mkdirSync(path.dirname(path.join(root, ROUTER_BUILD_MANIFEST)), { recursive: true });
  fs.writeFileSync(path.join(root, ROUTER_BUILD_MANIFEST), JSON.stringify({ schemaVersion: 1,
    hashes: routerBuildHashes(path.join(root, "server/backend")) }));
  // The profile verifies entry existence; these fixtures never start a service.
  const { entries } = backendInstallProfile(process.cwd());
  for (const entry of entries) { const file = path.join(root, entry.directory, entry.script); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, ""); }
  const profile = backendInstallProfile(root), npm = path.join(root, "npm-fixture.js"); fs.writeFileSync(npm, "");
  const installed = () => {
    fs.mkdirSync(path.join(root, "node_modules/@changmen"), { recursive: true });
    for (const name of profile.workspaces) fs.symlinkSync(path.join(root, packages.get(name).dir), path.join(root, "node_modules", name), "junction");
  };
  return { root, profile, npm, installed };
}
test("the production installer selects six Node roots, enables lifecycle scripts and verifies actual workspace targets", t => {
  const f = fixture(t);
  const report = installBackend(f.root, { npm: f.npm, run: (node, args, options) => {
    assert.equal(node, process.execPath); assert.deepEqual(args, [f.npm, ...f.profile.installArgs]);
    assert(args.includes("--ignore-scripts=false")); assert(args.includes("--include-workspace-root=false"));
    assert(args.includes("--omit=dev")); assert(!args.includes("--include=dev"));
    assert.equal(options.cwd, f.root); f.installed(); return { status: 0 };
  } });
  assert.equal(report.passed, true); assert.equal(report.workspaces.length, 17);
  assert.equal(report.developmentToolsAbsent, true); assert.equal(report.precompiledRouterVerified, true);
});
test("failed or timed-out installation cannot be accepted even with existing links", t => {
  const f = fixture(t); f.installed();
  for (const result of [{ status: 1 }, { status: 0, error: { code: "ETIMEDOUT" } }, { status: null, signal: "SIGTERM" }])
    assert.throws(() => installBackend(f.root, { npm: f.npm, run: () => result }), /installation failed/);
});
test("extra browser packages, redirected workspace links and changed lock inputs are rejected", t => {
  const f = fixture(t); f.installed();
  fs.mkdirSync(path.join(f.root, "node_modules/vue"));
  assert.throws(() => verifyBackendInstallation(f.root), /Forbidden package vue/);
  fs.rmdirSync(path.join(f.root, "node_modules/vue"));
  const link = path.join(f.root, "node_modules/@changmen/db"); fs.unlinkSync(link);
  fs.symlinkSync(path.join(f.root, "packages/shared"), link, "junction");
  assert.throws(() => verifyBackendInstallation(f.root), /Wrong installed workspace target/);
  assert.throws(() => installBackend(f.root, { npm: f.npm, run: () => {
    fs.appendFileSync(path.join(f.root, "package-lock.json"), " "); return { status: 0 };
  } }), /changed package or lock/);
});

test("missing or changed compiled routes fail before npm; build tools cannot pass installation verification", t => {
  const f = fixture(t); f.installed();
  for (const name of ["vitest", "vite", "vue-tsc", "turbo", "eslint"]) {
    const target = path.join(f.root, "node_modules", name); fs.mkdirSync(target);
    assert.throws(() => verifyBackendInstallation(f.root), /Forbidden package/); fs.rmdirSync(target);
  }
  fs.appendFileSync(path.join(f.root, "server/backend/core/esport-api/router.js"), "changed");
  assert.throws(() => installBackend(f.root, { npm: f.npm, run: () => { throw Error("npm must not run"); } }), /Precompiled router changed/);
  fs.unlinkSync(path.join(f.root, ROUTER_BUILD_MANIFEST));
  assert.throws(() => installBackend(f.root, { npm: f.npm, run: () => { throw Error("npm must not run"); } }), /ENOENT/);
});
