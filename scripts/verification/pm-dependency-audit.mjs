// [changmen 扩展] Bounded PM source/installation evidence. Never execute inspected modules.
import fs from "node:fs";
import path from "node:path";
import { builtinModules, createRequire } from "node:module";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createComponentInspection } from "./component-entry-boundary.mjs";
import { inspectPmSharedLoaders } from "./pm-shared-loader-evidence.mjs";
import { inspectPmLoaderBindings } from "./pm-loader-bindings.mjs";
import { ownsRelocatedVenueBrowser, VENUE_BROWSER_OWNER } from "./venue-browser-layout.mjs";

const dynamicKinds = new Set(["dynamic-import", "module-url", "require", "custom-loader", "computed-loader"]);
const packageName = spec => spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
const inside = (file, dir) => file === dir || file.startsWith(`${dir}/`);
const relative = (root, file) => path.relative(root, file).replaceAll("\\", "/");
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const siteKey = site => JSON.stringify([site.file, site.kind, site.spec]);

export function checkPmVuePeer(adapter, host) {
  const range = adapter.peerDependencies?.vue;
  return !range || adapter.dependencies?.vue || adapter.peerDependenciesMeta?.vue?.optional !== true || range !== host.dependencies?.vue
    ? [{ rule: "pm-vue-host-peer", file: "packages/venue-adapter/package.json", line: 0, spec: "vue",
      pattern: "PM browser Vue must be supplied by web using the same declared range; adapter uses optional peer for Node-only consumers" }]
    : [];
}

/** Only explicit PM browser requests are denied here; opaque roots remain uncertified. */
export function pmNodeBrowserLoaderTarget(site) {
  if (site.environment !== "node" || site.kind !== "custom-loader" || !site.arguments?.length || site.arguments.some(value => typeof value !== "string")) return null;
  const symbol = site.loaderSymbol || site.loader, args = site.arguments;
  if (symbol === "backendRequire" && (/^@changmen\/(?:venue-adapter\/(?:polymarket|browser)|pm-market-data-browser|venue-browser)(?:\/|$)/.test(args[0])
    || args[0] === "@changmen/venue-adapter/registry/adapters")) return args[0];
  let target;
  if (symbol === "adapterRequire") target = path.posix.normalize(`packages/venue-adapter/${args.join("/")}`);
  if (symbol === "requirePlatform" && args[0].toLowerCase() === "polymarket") {
    target = ["node", "backend"].includes(args[1])
      ? path.posix.normalize(`server/platform-probes/polymarket/${args.slice(2).join("/")}`)
      : path.posix.normalize(`packages/venue-adapter/polymarket/${args.slice(1).join("/")}`);
  }
  return target && (inside(target, "packages/venue-adapter/polymarket") && !inside(target, "packages/venue-adapter/polymarket/shared")
    || inside(target, "packages/venue-adapter/browser") || inside(target, "client/packages/venue-browser") || (inside(target, "packages/pm-market-data-browser") || inside(target, "client/packages/pm-market-data-browser")) || target === "packages/venue-adapter/registry/adapters.ts") ? target : null;
}

export function comparePmDynamicSites(actual, expected) {
  const counts = new Map(), violations = [];
  for (const site of actual) counts.set(siteKey(site), (counts.get(siteKey(site)) || 0) + 1);
  const registered = new Set();
  for (const row of expected) {
    const key = siteKey(row);
    if (registered.has(key) || !Number.isInteger(row.count) || row.count < 1 || typeof row.spec !== "string") throw Error(`Invalid PM dynamic registration: ${key}`);
    registered.add(key);
    if (counts.get(key) !== row.count) violations.push({ rule: "pm-dynamic-input", file: row.file, line: 0, spec: row.spec,
      pattern: `reviewed dynamic target count changed: expected ${row.count}, found ${counts.get(key) || 0}` });
  }
  for (const site of actual) if (!registered.has(siteKey(site))) violations.push({ rule: "pm-dynamic-input", ...site,
    pattern: "new or computed PM dynamic input requires explicit target review" });
  return violations;
}

/** Nearest installed package + exact lock record; not a Vite/ESM conditional-export proof. */
export function installedPmDependency(root, importer, spec, lock = readJson(path.join(root, "package-lock.json"))) {
  const name = packageName(spec);
  function nearest(start, suffix, predicate = () => true) {
    for (let dir = start; ; dir = path.dirname(dir)) {
      const file = path.join(dir, suffix);
      if (fs.existsSync(file)) {
        const json = readJson(file);
        if (predicate(json)) return { file, json };
      }
      if (dir === root || path.dirname(dir) === dir) break;
    }
    return undefined;
  }
  const importerDir = path.dirname(path.join(root, importer));
  const owner = nearest(ownsRelocatedVenueBrowser(importer) ? path.join(root, VENUE_BROWSER_OWNER) : importerDir, "package.json");
  const installed = nearest(importerDir, `node_modules/${name}/package.json`, json => json.name === name);
  const runtimeFields = ["dependencies", "peerDependencies", "optionalDependencies"];
  const declaration = owner && runtimeFields.find(field => Object.hasOwn(owner.json[field] || {}, name));
  const installedRoot = installed && path.dirname(fs.realpathSync(installed.file));
  const lockKey = installedRoot && relative(root, installedRoot);
  const lockEntry = lockKey && !lockKey.startsWith("../") && lock.packages?.[lockKey];
  let nodeRequireTarget;
  try { nodeRequireTarget = relative(root, createRequire(path.join(root, importer)).resolve(spec)); }
  catch { /* Import/browser conditions can differ; do not call require() or downgrade the evidence. */ }
  const subpath = spec === name ? "." : `.${spec.slice(name.length)}`;
  const exports = installed?.json.exports;
  const flatten = value => typeof value === "string" ? [value] : value && typeof value === "object" ? Object.values(value).flatMap(flatten) : [];
  let targets = typeof exports === "string" ? subpath === "." ? [exports] : []
    : exports?.[subpath] ? flatten(exports[subpath])
      : subpath === "." && exports && !Object.keys(exports).some(key => key.startsWith(".")) ? flatten(exports) : [];
  if (exports && !targets.length && typeof exports === "object") for (const [key, value] of Object.entries(exports)) {
    if (!key.includes("*")) continue;
    const [head, tail] = key.split("*");
    if (subpath.startsWith(head) && subpath.endsWith(tail)) targets.push(...flatten(value).map(item => item.replaceAll("*", subpath.slice(head.length, tail ? -tail.length : undefined))));
  }
  const runtimeExportTargets = targets.filter(target => target.startsWith("./") && !target.split("/").includes("..") && !/\.d\.[cm]?ts$/.test(target)
    && fs.existsSync(path.join(installedRoot, target))).map(target => relative(root, path.join(installedRoot, target)));
  const specifierTargetExists = Boolean(nodeRequireTarget && fs.existsSync(path.join(root, nodeRequireTarget))) || runtimeExportTargets.length > 0;
  return {
    name, spec, owner: owner && relative(root, owner.file), declaration: declaration || null,
    declarationRange: declaration ? owner.json[declaration][name] : null,
    peerOptional: declaration === "peerDependencies" && owner.json.peerDependenciesMeta?.[name]?.optional === true,
    declaredRuntime: Boolean(declaration), declaredDevelopment: Boolean(owner?.json.devDependencies?.[name]), installedPackage: installed && relative(root, installed.file),
    installedVersion: installed?.json.version, lockKey, lockedVersion: lockEntry?.version,
    lockVersionMatches: Boolean(installed && lockEntry && installed.json.version === lockEntry.version),
    lockIntegrityPresent: Boolean(lockEntry?.integrity), nodeRequireTarget, runtimeExportTargets, specifierTargetExists,
    browserExportSelectionCertified: false, installationClosureCertified: false,
  };
}

export function inspectPmDependencies(root) {
  root = fs.realpathSync(root);
  const manifest = readJson(path.join(root, "scripts/deploy/component-inputs.json"));
  const contract = readJson(path.join(root, "scripts/verification/pm-dependency-inputs.json"));
  if (contract.schemaVersion !== 1 || contract.purpose !== "pm-dynamic-input-review-only" || contract.publishScopeOptimizationEnabled !== false) throw Error("PM evidence cannot enable publish scope optimization");
  const inspection = createComponentInspection(root);
  const graph = inspection.inspect(manifest, { scope: "pm" });
  const roots = [...manifest.scopes.pm.nodeRoots, ...manifest.scopes.pm.browserRoots];
  const primary = file => roots.some(dir => inside(file, dir));
  const dynamicSites = graph.dependencies.filter(site => primary(site.file) && dynamicKinds.has(site.kind));
  const violations = [...graph.violations, ...comparePmDynamicSites(dynamicSites, contract.dynamicSites)];
  for (const site of graph.dependencies) {
    const target = pmNodeBrowserLoaderTarget(site);
    if (target) violations.push({ rule: "pm-node-browser-loader", ...site, pattern: `Node loader explicitly requests a PM browser entry: ${target}` });
  }
  const lock = readJson(path.join(root, "package-lock.json"));
  const externalDependencies = [], externalKeys = new Set();
  for (const site of graph.dependencies) {
    if (!primary(site.file) || !site.spec || site.targets.length || site.spec.startsWith(".") || site.spec.startsWith("@changmen/")
      || builtinModules.includes(site.spec) || site.spec.startsWith("node:") || !["static", "dynamic-import", "type", "require"].includes(site.kind)) continue;
    const fact = installedPmDependency(root, site.file, site.spec, lock);
    const key = `${fact.owner}\0${site.spec}\0${site.environment}`;
    if (externalKeys.has(key)) {
      externalDependencies.find(fact => `${fact.owner}\0${fact.spec}\0${fact.environment}` === key).typeOnly &&= site.kind === "type";
      continue;
    }
    externalKeys.add(key);
    externalDependencies.push({ ...fact, typeOnly: site.kind === "type", environment: site.environment, importer: site.file });
    if (!fact.installedPackage || !fact.lockVersionMatches || !fact.specifierTargetExists) violations.push({ rule: "pm-installed-input", file: site.file, line: site.line, spec: site.spec,
      pattern: "PM external input lacks matching installed-package/lock/subpath evidence" });
  }
  const primaryUnknowns = graph.unknown.filter(site => primary(site.file));
  const explainedPrimaryUnknowns = primaryUnknowns.filter(site => externalDependencies.some(fact => fact.spec === site.spec && fact.lockVersionMatches && fact.specifierTargetExists));
  const unexplainedPrimaryUnknowns = primaryUnknowns.filter(site => !explainedPrimaryUnknowns.includes(site));
  for (const site of unexplainedPrimaryUnknowns) violations.push({ rule: "pm-unresolved-input", ...site, pattern: "unexplained PM source input requires review" });

  const inheritedUnknowns = graph.unknown.filter(site => !primary(site.file)).map(site => ({ ...site,
    category: site.file === "server/venues/loader/adapter_paths.mjs" || site.kind === "custom-loader"
      ? "shared-platform-loader" : /^server\/db\//.test(site.file) ? "shared-database-module-search" : "unclassified-shared-input",
    closed: false,
  }));
  const sharedLoaderEvidence = inspectPmSharedLoaders(root, inheritedUnknowns);
  violations.push(...sharedLoaderEvidence.violations);
  const loaderBindings = inspectPmLoaderBindings(root, manifest, graph, sharedLoaderEvidence, inspection);
  violations.push(...loaderBindings.violations);
  for (const call of loaderBindings.calls) {
    const site = { ...call, environment: "node", kind: "custom-loader", loaderSymbol: call.origin.symbol };
    const target = pmNodeBrowserLoaderTarget(site);
    if (target) violations.push({ rule: "pm-node-browser-loader", ...site, pattern: `source-bound Node loader requests a PM browser entry: ${target}` });
  }
  const inputEvidence = contract.supportInputs.map(file => {
    if (path.isAbsolute(file) || file.split("/").includes("..")) throw Error(`Invalid PM support input: ${file}`);
    return { file, sha256: createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest("hex") };
  });
  const sharedExternalPackages = [...new Set(externalDependencies.map(fact => fact.name))].filter(name =>
    new Set(externalDependencies.filter(fact => fact.name === name).map(fact => fact.environment)).size > 1);
  const undeclaredRuntimeDependencies = externalDependencies.filter(fact => !fact.declaredRuntime && !(fact.typeOnly && fact.declaredDevelopment));
  for (const fact of undeclaredRuntimeDependencies.filter(fact => ["packages/venue-adapter/package.json", "client/packages/venue-browser/package.json", "client/packages/pm-market-data-browser/package.json",
    "packages/venue-adapter/loader/package.json", "packages/venue-adapter/registry/package.json"].includes(fact.owner))) violations.push({
    rule: "pm-direct-dependency", file: fact.owner, line: 0, spec: fact.name, pattern: "PM direct import must be declared by its owning package; a host/transitive installation is insufficient",
  });
  violations.push(...checkPmVuePeer(readJson(path.join(root, "client/packages/venue-browser/package.json")), readJson(path.join(root, "client/web/package.json"))));
  return {
    schemaVersion: 1, scope: "pm", publishScopeOptimizationEnabled: false, safeToNarrowPublishScope: false,
    nodeSourceFiles: graph.nodeSourceFiles, browserSourceFiles: graph.browserSourceFiles, scannedSourceFiles: graph.sourceFiles.length,
    sourceFiles: graph.sourceFiles, dynamicSites, externalDependencies, inputEvidence,
    unknownSummary: { raw: graph.unknown.length, primary: primaryUnknowns.length, explainedPrimary: explainedPrimaryUnknowns.length,
      unexplainedPrimary: unexplainedPrimaryUnknowns.length, inherited: inheritedUnknowns.length },
    explainedPrimaryUnknowns, unexplainedPrimaryUnknowns, inheritedUnknowns, sharedLoaderEvidence, loaderBindings,
    sharedExternalPackages, undeclaredRuntimeDependencies,
    blockers: [
      { id: "undeclared-runtime-install", applies: undeclaredRuntimeDependencies.length > 0, changes: ["package.json", "package-lock.json", "hoisting/install layout"], evidence: undeclaredRuntimeDependencies.map(fact => ({ spec: fact.spec, owner: fact.owner, version: fact.installedVersion })) },
      { id: "shared-sdk-install", applies: sharedExternalPackages.length > 0, changes: ["shared SDK versions", "root dependency graph"], evidence: sharedExternalPackages },
      { id: "shared-fixed-target-inputs", applies: sharedLoaderEvidence.byClass["fixed-target"] > 0, changes: ["fixed target files", "PG installation/search", "registry target mapping"] },
      { id: "shared-environment-and-preload", applies: sharedLoaderEvidence.byClass["environment-dependent"] > 0, changes: ["adapter/probes/backend roots", "manifest preload", "external/bundled contents"] },
      { id: "shared-open-parameter-ports", applies: sharedLoaderEvidence.byClass["parameter-unknown"] > 0, changes: ["reqS/backendRequire use", "generic adapterRequire", "unrecognized indirect loader use"] },
      { id: "build-and-release-controls", applies: true, changes: ["Vite aliases/polyfills", "skinny bundle options", "source fingerprints", "deployed baseline comparison", "publish selection"] },
    ],
    limitations: ["Only PM roots and their source dependencies are traversed; unrelated historical scripts are not seeded or repaired.", "Installed versions/lock entries and Node require resolution do not certify browser export branches, installation effects or deployed old trees.", "Reviewed literal imports are dependency targets, not proof that a lazy chunk is absent from the main bundle or disabled at runtime."],
    violations,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = inspectPmDependencies(fileURLToPath(new URL("../../", import.meta.url)));
  if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`pm-dependency: ${report.dynamicSites.length} reviewed dynamic sites; ${report.unknownSummary.unexplainedPrimary} unexplained PM inputs; shared classification ${JSON.stringify(report.sharedLoaderEvidence.byClass)}; publish scope unchanged`);
    for (const v of report.violations) console.error(`${v.file}:${v.line}: ${v.pattern}`);
  }
  if (report.violations.length) process.exitCode = 1;
}
