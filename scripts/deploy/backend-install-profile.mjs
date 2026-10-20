// [changmen 扩展] Installation closure for all eight production processes.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { backendProcesses } from "./verify-backend-processes.mjs";
import { readInstallWorkspaces, declaredInstallClosure } from "../verification/component-install-inputs.mjs";

export const forbiddenBackendPackages = ["@changmen/web", "@changmen/chrome-extension", "@changmen/venue-adapter",
  "@changmen/client-core", "@changmen/pm-market-data-browser", "@changmen/venue-browser", "vue", "pinia"];
const safeRelative = value => typeof value === "string" && value.length > 0 && !path.isAbsolute(value)
  && !value.includes("\\") && !value.includes(":") && !value.split("/").some(part => !part || part === "." || part === "..");

export function backendInstallProfile(root, { processes = backendProcesses, packages = readInstallWorkspaces(root),
  apps = createRequire(path.join(root, "package.json"))(path.join(root, "deploy/ecosystem.config.cjs")).apps } = {}) {
  const entries = [], roots = new Set(), workspaces = new Set(), directories = new Set(), violations = [];
  for (const [name, tuple] of Object.entries(processes)) {
    assert(Array.isArray(tuple) && tuple.length === 2 && tuple.every(safeRelative), `Unsafe process entry: ${name}`);
    const [directory, script] = tuple, owner = [...packages.values()].find(item => item.dir === directory);
    assert(owner, `Process has no declared workspace: ${name}`);
    const matching = apps.filter(app => app.name === name);
    assert.equal(matching.length, 1, `Process configuration mismatch: ${name}`);
    assert.equal(path.resolve(matching[0].cwd), path.resolve(root, directory), `Process cwd changed: ${name}`);
    assert.equal(matching[0].script, script, `Process script changed: ${name}`);
    assert.equal(matching[0].interpreter, "node", `Unsupported interpreter: ${name}`);
    assert(fs.existsSync(path.join(root, directory, script)), `Missing process source: ${name}`);
    entries.push({ name, directory, script, workspace: owner.pkg.name }); roots.add(owner.pkg.name);
  }
  assert.equal(entries.length, 8, "All eight current production process entries are required");
  const closures = [...roots].sort().map(name => declaredInstallClosure(root, packages, name, { build: true }));
  for (const closure of closures) {
    violations.push(...closure.violations);
    closure.workspaces.forEach(name => workspaces.add(name));
    closure.workspaceDirectories.forEach(dir => directories.add(dir));
    for (const edge of closure.edges) if (forbiddenBackendPackages.includes(edge.name)
      || edge.target && /^(?:client|chrome-extension)\//.test(edge.target))
      violations.push({ file: `${edge.from}/package.json`, spec: edge.name, pattern: `Browser installation through ${edge.via.join(" -> ")}` });
  }
  assert.deepEqual(violations, [], "Backend installation cannot contain unknown/local-target or browser dependencies");
  return { schemaVersion: 1, purpose: "backend-workspace-installation", productionEnabled: true,
    archiveSlimmingEnabled: false, entries, roots: [...roots].sort(), workspaces: [...workspaces].sort(),
    workspaceDirectories: [...directories].sort(), closures,
    installArgs: ["ci", ...[...roots].sort().map(name => `--workspace=${name}`), "--include=dev", "--include-workspace-root=false", "--ignore-scripts=false"],
    limitations: ["The full repository archive and loader resources remain required.",
      "Development dependencies remain installed for the existing router compilation.",
      "Linux lifecycle and eight-process checks are required before backend publication."] };
}

export function assertBackendInstalledLinks(profile, links) {
  assert.deepEqual([...links].sort(), profile.workspaces.map(name => name.slice("@changmen/".length)).sort(),
    "Installed workspace links must exactly cover the eight-process closure");
}

// Package-root resolution can fail for an installed package with only subpath exports.
// Check its directory in every selected workspace's Node lookup paths instead; never import it.
export function assertBackendBrowserPackagesAbsent(root, profile, { includeAncestors = true } = {}) {
  for (const directory of profile.workspaceDirectories) {
    const require = createRequire(path.resolve(root, directory, "package.json"));
    for (const name of forbiddenBackendPackages) {
      for (const lookup of require.resolve.paths(name) || []) {
        // A managed release can have a legacy full installation in an ancestor.
        // Verify the new installation without modifying a retained rollback tree.
        const relative = path.relative(path.resolve(root), path.resolve(lookup));
        if (!includeAncestors && (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative))) continue;
        const target = path.join(lookup, name);
        assert(!fs.existsSync(target), `Browser package ${name} is installed for ${directory}: ${target}`);
      }
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { assert.equal(process.argv.length, 2, "Read-only profile accepts no activation/install options");
    console.log(JSON.stringify(backendInstallProfile(process.cwd()), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
