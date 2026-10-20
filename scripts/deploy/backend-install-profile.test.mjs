import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { backendProcesses } from "./verify-backend-processes.mjs";
import { readInstallWorkspaces } from "../verification/component-install-inputs.mjs";
import { backendInstallProfile, assertBackendInstalledLinks, assertBackendBrowserPackagesAbsent, forbiddenBackendPackages } from "./backend-install-profile.mjs";
const root = process.cwd();
test("candidate profile covers eight actual processes, six install roots and their Node build resources", () => {
  const p = backendInstallProfile(root);
  assert.equal(p.productionEnabled, false); assert.equal(p.archiveSlimmingEnabled, false);
  assert.equal(p.entries.length, 8); assert.equal(p.roots.length, 6); assert.equal(p.workspaces.length, 16);
  for (const name of ["@changmen/polymarket-esports-collector", "@changmen/polymarket-football-collector", "@changmen/predictfun-collector",
    "@changmen/venue-node", "@changmen/runtime-tooling"]) assert(p.workspaces.includes(name));
  assert(!p.roots.includes("@changmen/sxbet-collector"));
  assert(p.installArgs.includes("--include=dev")); assert(p.installArgs.includes("--include-workspace-root=false"));
  const links = p.workspaces.map(name => name.slice("@changmen/".length));
  assertBackendInstalledLinks(p, links);
  assert.throws(() => assertBackendInstalledLinks(p, links.slice(1)));
  assert.throws(() => assertBackendInstalledLinks(p, [...links, "venue-adapter"]));
  assert.throws(() => assertBackendInstalledLinks(p, [...links, "venue-browser"]));
  assert(forbiddenBackendPackages.includes("@changmen/venue-browser"));
});

for (const directory of ["", "server/backend", "server/ws_forward"]) test(`detects installed subpath-only browser packages at ${directory || "repository root"}`, () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "changmen-browser-install-"));
  const profile = { workspaceDirectories: ["server/backend", "server/ws_forward"] };
  try {
    assertBackendBrowserPackagesAbsent(temporary, profile);
    const target = path.join(temporary, directory, "node_modules/@changmen/venue-browser");
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, "package.json"), JSON.stringify({ name: "@changmen/venue-browser", exports: { "./entry": "./entry.js" } }));
    fs.writeFileSync(path.join(target, "entry.js"), "throw Error('must never execute browser code');");
    const require = createRequire(path.join(temporary, directory || "server/backend", "package.json"));
    assert.throws(() => require.resolve("@changmen/venue-browser"), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
    assert.equal(require.resolve("@changmen/venue-browser/entry"), path.join(target, "entry.js"));
    assert.throws(() => assertBackendBrowserPackagesAbsent(temporary, profile), /Browser package @changmen\/venue-browser is installed/);
  } finally {
    assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
    assert(path.basename(temporary).startsWith("changmen-browser-install-"));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
for (const group of ["dependencies", "optionalDependencies", "peerDependencies", "devDependencies"]) test(`rejects browser dependency in selected ${group}`, () => {
  const packages = readInstallWorkspaces(root), pkg = packages.get("@changmen/predictfun-collector").pkg;
  pkg[group] = { ...pkg[group], vue: "^3.5.13" };
  assert.throws(() => backendInstallProfile(root, { packages }), /browser dependencies/);
});
test("rejects indirect browser workspace, unresolved local target and omitted process owner", () => {
  for (const change of [p => { p.get("@changmen/shared").pkg.dependencies = { "@changmen/client-core": "file:../client-core" }; },
    p => { p.get("@changmen/shared").pkg.dependencies = { "@changmen/missing": "file:../missing" }; },
    p => { p.delete("@changmen/predictfun-collector"); }]) {
    const packages = readInstallWorkspaces(root); change(packages);
    assert.throws(() => backendInstallProfile(root, { packages }));
  }
});
test("rejects a process dropped from the closure or redirected outside its reviewed entry", () => {
  const processes = structuredClone(backendProcesses); delete processes["changmen-predictfun-collector"];
  assert.throws(() => backendInstallProfile(root, { processes }), /eight/);
  for (const target of ["../outside", "C:/outside", "/outside", "server\\backend"])
    assert.throws(() => backendInstallProfile(root, { processes: { ...backendProcesses, "changmen-esport": [target, "start.js"] } }), /Unsafe/);
  const apps = structuredClone(createRequire(import.meta.url)("../../deploy/ecosystem.config.cjs").apps);
  apps.find(app => app.name === "changmen-predictfun-collector").script = "other.js";
  assert.throws(() => backendInstallProfile(root, { apps }), /script changed/);
});
