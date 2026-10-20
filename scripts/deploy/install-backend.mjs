// [changmen 扩展] Shared by production and the isolated Linux installation check.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { backendInstallProfile, assertBackendInstalledLinks, assertBackendBrowserPackagesAbsent } from "./backend-install-profile.mjs";
import { readInstallWorkspaces } from "../verification/component-install-inputs.mjs";

export function verifyBackendInstallation(root, profile = backendInstallProfile(root)) {
  const links = fs.readdirSync(path.join(root, "node_modules/@changmen"));
  assertBackendInstalledLinks(profile, links);
  const packages = readInstallWorkspaces(root);
  for (const name of profile.workspaces) assert.equal(fs.realpathSync(path.join(root, "node_modules", name)),
    fs.realpathSync(path.join(root, packages.get(name).dir)), `Wrong installed workspace target: ${name}`);
  assertBackendBrowserPackagesAbsent(root, profile, { includeAncestors: false });
  return { passed: true, workspaces: profile.workspaces, roots: profile.roots, browserPackagesAbsent: true };
}

export function installBackend(root, { run = spawnSync, npm = process.env.npm_execpath || [
  path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
  path.resolve(path.dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js"),
].find(file => fs.existsSync(file)) } = {}) {
  const profile = backendInstallProfile(root);
  assert(profile.productionEnabled, "Backend installation is not enabled");
  assert(npm && fs.existsSync(npm), "npm JavaScript CLI is unavailable");
  const hashes = () => ["package.json", "package-lock.json"].map(file => createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest("hex"));
  const before = hashes();
  const result = run(process.execPath, [npm, ...profile.installArgs], { cwd: root, stdio: "inherit", windowsHide: true });
  assert(result.status === 0 && !result.error && !result.signal, "Backend workspace installation failed");
  assert.deepEqual(hashes(), before, "Backend installation changed package or lock inputs");
  const report = verifyBackendInstallation(root, profile);
  fs.mkdirSync(path.join(root, "output"), { recursive: true });
  fs.writeFileSync(path.join(root, "output/backend-installation.json"), JSON.stringify({ ...report,
    node: process.version, installArgs: profile.installArgs }, null, 2));
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.argv.length, 2, "Backend installer accepts no overrides");
    console.log(JSON.stringify(installBackend(process.cwd())));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
