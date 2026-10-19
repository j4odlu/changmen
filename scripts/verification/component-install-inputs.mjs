// [changmen 扩展] Installation inputs only; never selects a production install or release.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const json = file => JSON.parse(fs.readFileSync(file, "utf8"));
const hash = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
export function readInstallWorkspaces(root) {
  const packages = new Map();
  for (const pattern of json(path.join(root, "package.json")).workspaces) {
    if (typeof pattern !== "string" || path.isAbsolute(pattern) || pattern.includes("\\") || pattern.split("/").includes("..")
      || pattern.includes("*") && !pattern.endsWith("/*")) throw Error(`Unsupported workspace path: ${pattern}`);
    const directories = pattern.endsWith("/*") ? fs.readdirSync(path.join(root, pattern.slice(0, -2)), { withFileTypes: true })
      .filter(item => item.isDirectory()).map(item => `${pattern.slice(0, -1)}${item.name}`) : [pattern];
    for (const dir of directories) {
      const file = path.join(root, dir, "package.json");
      if (!fs.existsSync(file)) continue;
      const pkg = json(file);
      if (!pkg.name || packages.has(pkg.name)) throw Error(`Invalid/duplicate workspace: ${dir}`);
      packages.set(pkg.name, { dir, pkg });
    }
  }
  return packages;
}
export function declaredInstallClosure(root, packages, name, { build = false } = {}) {
  const queue = [{ name, via: [name] }], seen = new Set(), external = new Set(), edges = [], violations = [];
  while (queue.length) {
    const item = queue.shift();
    if (seen.has(item.name)) continue;
    const owner = packages.get(item.name);
    if (!owner) throw Error(`Missing install workspace: ${item.name}`);
    seen.add(item.name);
    const groups = ["dependencies", "optionalDependencies", "peerDependencies", ...(build && item.name === name ? ["devDependencies"] : [])];
    for (const group of groups) for (const [dependency, range] of Object.entries(owner.pkg[group] || {})) {
      const via = [...item.via, dependency], target = packages.get(dependency);
      edges.push({ from: owner.dir, name: dependency, group, range, via, ...(target ? { target: target.dir } : {}) });
      if (target) {
        if (typeof range !== "string" || !range.startsWith("file:") || path.resolve(root, owner.dir, range.slice(5)) !== path.resolve(root, target.dir))
          violations.push({ file: `${owner.dir}/package.json`, spec: dependency, pattern: "Install closure has an incorrect local dependency target" });
        queue.push({ name: dependency, via });
      } else if (dependency.startsWith("@changmen/") || typeof range !== "string" || range.startsWith("file:"))
        violations.push({ file: `${owner.dir}/package.json`, spec: dependency, pattern: "Unknown local install dependency" });
      else external.add(dependency);
    }
  }
  return { root: name, build, workspaces: [...seen].sort(), workspaceDirectories: [...seen].map(value => packages.get(value).dir).sort(),
    directExternalPackages: [...external].sort(), edges, violations };
}
// Browser installation must not pull Node workspaces through a shared/adapter declaration.
export function frontendInstallBoundary(profile) {
  const toolingEdge = edge => edge.name === "@changmen/runtime-tooling" && edge.target === "devtools/runtime-tooling"
    && profile.build === true && profile.root === "@changmen/web" && edge.from === "client/web" && edge.group === "devDependencies";
  return profile.edges.filter(edge => edge.target && !toolingEdge(edge) && (/^(?:server|devtools)\//.test(edge.target)
    || edge.target === "packages/shared/tooling"
    || /^packages\/venue-adapter\/(?:loader|registry|scripts)(?:\/|$)/.test(edge.target)))
    .map(edge => ({ file: `${edge.from}/package.json`, spec: edge.name,
      pattern: `Frontend install reaches a Node/data workspace: ${edge.via.join(" -> ")}` }));
}
// The one frontend build tool is builtin-only and explicitly owned by its Node/build hosts.
export function runtimeToolingDeclarationBoundary(packages) {
  const violations = [], name = "@changmen/runtime-tooling", tool = packages.get(name);
  const fail = (file, pattern) => violations.push({ file, spec: name, pattern });
  const expected = { "./runtime_version.js": "./runtime_version.js", "./dev_web_port.js": "./dev_web_port.js" };
  if (!tool || tool.dir !== "devtools/runtime-tooling" || tool.pkg.type !== "module" || tool.pkg.version !== "1.0.0"
    || JSON.stringify(tool.pkg.exports) !== JSON.stringify(expected)
    || JSON.stringify(tool.pkg.files) !== JSON.stringify(["runtime_version.js", "runtime_version.d.ts", "dev_web_port.js", "dev_web_port.d.ts"])
    || ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies", "scripts"].some(group => Object.keys(tool.pkg[group] || {}).length))
    fail("devtools/runtime-tooling/package.json", "Node identity tool must retain exact exports and no package dependencies or lifecycle scripts");
  const shared = packages.get("@changmen/shared")?.pkg;
  if (["dependencies", "optionalDependencies", "devDependencies", "peerDependencies"].some(group => shared?.[group]?.[name] || shared?.[group]?.["@changmen/runtime-tooling-compat"]))
    fail("packages/shared/package.json", "Shared runtime declarations must not install Node tooling or its legacy compatibility workspace");
  const compat = packages.get("@changmen/runtime-tooling-compat");
  if (!compat || compat.dir !== "packages/shared/tooling" || compat.pkg.type !== "module"
    || JSON.stringify(compat.pkg.exports) !== JSON.stringify(expected)
    || JSON.stringify(compat.pkg.files) !== JSON.stringify(["runtime_version.js", "runtime_version.d.ts", "dev_web_port.js", "dev_web_port.d.ts"])
    || JSON.stringify(compat.pkg.dependencies) !== JSON.stringify({ [name]: "file:../../../devtools/runtime-tooling" })
    || ["devDependencies", "optionalDependencies", "peerDependencies", "scripts"].some(group => Object.keys(compat.pkg[group] || {}).length))
    fail("packages/shared/tooling/package.json", "Legacy Node entries must own only the single canonical Node tool dependency");
  if (packages.get("@changmen/web")?.pkg.devDependencies?.[name] !== "file:../../devtools/runtime-tooling")
    fail("client/web/package.json", "Vite must explicitly own its Node tool as a development dependency");
  if (packages.get("@changmen/storage")?.pkg.dependencies?.[name] !== "file:../../devtools/runtime-tooling")
    fail("server/storage/package.json", "Server runtime must explicitly own its Node tool as a production dependency");
  return violations;
}
export function venueBrowserDeclarationBoundary(packages) {
  const violations = [], adapter = packages.get("@changmen/venue-adapter"), tools = packages.get("@changmen/venue-adapter-tools");
  for (const [name, target] of Object.entries({ "@changmen/api-contract": "file:../api-contract", "@changmen/client-core": "file:../../client/packages/client-core" }))
    if (adapter?.pkg.dependencies?.[name] !== target) violations.push({ file: "packages/venue-adapter/package.json", spec: name,
      pattern: "The browser adapter must retain its direct hosts for adjacent registry TypeScript consumers" });
  for (const group of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"])
    for (const name of ["@changmen/db", "@changmen/storage", "@changmen/venue-node-loader", "@changmen/venue-node-registry", "@changmen/venue-adapter-tools"])
      if (adapter?.pkg[group]?.[name]) violations.push({ file: "packages/venue-adapter/package.json", spec: name,
        pattern: `Browser adapter cannot own Node/data installation through ${group}; use the existing Node entry/tool workspace` });
  if (!tools || tools.dir !== "packages/venue-adapter/scripts" || tools.pkg.type !== "module"
    || JSON.stringify(tools.pkg.exports) !== JSON.stringify({ "./sync-backend-bundle.mjs": "./sync-backend-bundle.mjs" })
    || JSON.stringify(tools.pkg.files) !== JSON.stringify(["sync-backend-bundle.mjs"])
    || JSON.stringify(tools.pkg.scripts) !== JSON.stringify({ "sync:backend-bundle": "node sync-backend-bundle.mjs" })
    || JSON.stringify(tools.pkg.dependencies) !== JSON.stringify({ "@changmen/shared": "file:../../shared", "@changmen/storage": "file:../../../server/storage" }))
    violations.push({ file: "packages/venue-adapter/scripts/package.json", spec: "@changmen/venue-adapter-tools",
      pattern: "Backend bundle tool must declare its shared catalog and Node storage dependencies with the original source entry" });
  return violations;
}
export function inspectComponentInstallInputs(root) {
  const packages = readInstallWorkspaces(root), profiles = {};
  for (const [id, name] of Object.entries({ frontend: "@changmen/web", backend: "@changmen/backend", rds: "@changmen/db" })) {
    profiles[id] = declaredInstallClosure(root, packages, name);
    if (id === "frontend") profiles[id].build = declaredInstallClosure(root, packages, name, { build: true });
  }
  const frontendBackendEdges = profiles.frontend.edges.filter(edge => edge.target?.startsWith("server/"));
  const frontendIsolationViolations = [...frontendInstallBoundary(profiles.frontend), ...frontendInstallBoundary(profiles.frontend.build),
    ...venueBrowserDeclarationBoundary(packages), ...runtimeToolingDeclarationBoundary(packages)];
  const inputs = ["package.json", "package-lock.json", ...[...packages.values()].map(item => `${item.dir}/package.json`)];
  return { schemaVersion: 1, purpose: "component-install-inputs-only", publishScopeOptimizationEnabled: false,
    installationCertified: false, profiles, frontendBackendEdges, frontendDeclarationsIsolated: frontendIsolationViolations.length === 0,
    inputHashes: Object.fromEntries(inputs.map(file => [file, hash(path.join(root, file))])),
    violations: [...Object.values(profiles).flatMap(profile => [...profile.violations, ...(profile.build?.violations || [])]), ...frontendIsolationViolations],
    limitations: ["Declared closure is not npm's actual installed tree.", "Relative loader/storage roots and RDS SQL assets still require the retained repository layout.", "No install profile is activated by this report."] };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = inspectComponentInstallInputs(fileURLToPath(new URL("../../", import.meta.url)));
  console.log(JSON.stringify(report, null, 2));
  if (report.violations.length) process.exitCode = 1;
}
