// [changmen 扩展] Certify the default workspace's dynamic project inputs, without importing services.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import ts from "typescript";
import { captureBackendResolution } from "./backend-install-resolution.mjs";
import { analyzePmLoaderBindings } from "./pm-loader-bindings.mjs";
import { sharedLoaderSourceSignature } from "./pm-shared-loader-evidence.mjs";

const central = "server/venues/loader/adapter_paths.mjs";
const registry = "server/venues/registry";
const runtime = `${registry}/runtime`;
const probes = "server/platform-probes";
const helpers = [`${probes}/backend/_paths.js`, `${probes}/backend/_paths.cjs`];
const pgFiles = ["rds/pg_pool.js", "rds/resolve_database_url.js"];
export const dynamicPathEnvironmentKeys = ["CHANGMEN_ADAPTER_ROOT", "GAMEBET_ADAPTER_ROOT", "CHANGMEN_PLATFORM_PROBES_ROOT",
  "GAMEBET_PLATFORM_PROBES_ROOT", "CHANGMEN_NODE_ROOT", "GAMEBET_NODE_ROOT", "CHANGMEN_BACKEND_ROOT", "GAMEBET_BACKEND_ROOT", "NODE_PATH", "NODE_OPTIONS"];
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const key = row => JSON.stringify([row.file, row.kind, row.expression, row.loader, row.arguments]);
const callKey = row => JSON.stringify([row.file, row.origin, row.arguments]);
export const dynamicPathOrigins = [
  ...["reqS", "backendRequire", "adapterRequire", "requirePlatform", "getRegistryPaths", "resolvePlatformFile", "resetAdapterRootForTests"].map(symbol => ({ file: central, symbol })),
  ...helpers.flatMap(file => ["reqS", "backendRequire"].map(symbol => ({ file, symbol }))),
  ...["setPlatformNodeRootForTests", "resetPlatformNodeRootForTests", "resolvePlatformFile", "platformAdapterPath"].map(symbol => ({ file: `${registry}/paths.js`, symbol })),
];
export const dynamicPathContractFiles = [
  { file: central, selector: "module" }, ...pgFiles.map(file => ({ file, selector: "pg-loader" })),
  ...[`${registry}/paths.js`, `${runtime}/registry/paths.js`, `${runtime}/registry/feeds.js`,
    "server/storage/paths.ts", "server/storage/changmen_root.ts", ...helpers].map(file => ({ file, selector: "module" })),
];

function safe(root, file) {
  assert(typeof file === "string" && file && !path.isAbsolute(file) && !/^[a-z]:/i.test(file) && !file.includes("\\")
    && !file.split("/").some(part => ["..", ".", ""].includes(part)), `Invalid runtime target: ${file}`);
  const real = fs.realpathSync(path.join(root, file)), relative = path.relative(root, real).replaceAll("\\", "/");
  assert(relative !== ".." && !relative.startsWith("../") && !path.isAbsolute(relative), `Runtime target escaped installation: ${file}`);
  assert(!/^(?:client|chrome-extension|packages\/venue-adapter|devtools\/platform-probes)(?:\/|$)/.test(relative), `Browser/legacy runtime target: ${file}`);
  return { real, relative };
}
function evidence(root, file) {
  const { real, relative } = safe(root, file);
  assert(fs.statSync(real).isFile(), `Not a runtime file: ${file}`);
  const row = { file, target: relative, sha256: sha(fs.readFileSync(real)) };
  if (relative.includes("node_modules/")) {
    for (let directory = path.dirname(real); ; directory = path.dirname(directory)) {
      const pkgFile = path.join(directory, "package.json");
      if (fs.existsSync(pkgFile)) {
        const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8"));
        const lockKey = path.relative(root, directory).replaceAll("\\", "/");
        const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
        assert.equal(lock.packages[lockKey]?.version, pkg.version, "Dynamic SDK owner differs from lock");
        Object.assign(row, { package: pkg.name, version: pkg.version, lockKey, packageSha256: sha(fs.readFileSync(pkgFile)) }); break;
      }
      assert(directory !== root && directory !== path.dirname(directory), "Missing dynamic SDK owner");
    }
  }
  return row;
}
// Only exact token-contracted loader bodies are interpreted below. Remove their internal
// implementation from capability propagation; callers still bind to their real exports.
function bindingSource(file, source, selector) {
  if (!selector) return source;
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true), spans = [];
  for (const node of tree.statements) if (ts.isFunctionDeclaration(node) && node.body
    && (selector === "module" || node.name?.text === "requirePg")) spans.push([node.body.getStart(tree), node.body.end]);
  for (const [start, end] of spans.reverse()) source = source.slice(0, start) + "{" + source.slice(start + 1, end - 1).replace(/[^\r\n]/g, " ") + "}" + source.slice(end);
  return source;
}
function groupCalls(calls) {
  const grouped = new Map();
  for (const row of calls) { const id = callKey(row); const item = grouped.get(id) || { file: row.file, origin: row.origin, arguments: row.arguments, count: 0 }; item.count++; grouped.set(id, item); }
  return [...grouped.values()].sort((a, b) => callKey(a).localeCompare(callKey(b)));
}
function resolveRequest(root, call, manifest) {
  const args = call.arguments, symbol = call.origin.symbol;
  if (symbol === "adapterRequire") {
    assert(args.length === 2 && args[0] === "registry" && ["paths.js", "feeds.js"].includes(args[1]), "Unreviewed generic adapterRequire request");
    return evidence(root, `${runtime}/${args.join("/")}`);
  }
  if (symbol === "requirePlatform") {
    const entry = manifest.find(row => row.id.toUpperCase() === args[0]?.toUpperCase());
    assert(entry && ["node", "backend"].includes(args[1]) && args.length > 2, "Unreviewed platform request");
    return evidence(root, `${probes}/${entry.dir}/${args.slice(2).join("/")}`);
  }
  assert(["reqS", "backendRequire"].includes(symbol), `Unreviewed root/registry capability call: ${symbol}`);
  const spec = symbol === "reqS" ? `@changmen/shared/${args.join("/")}` : args[0];
  assert(symbol !== "backendRequire" || args.length === 1, "Invalid backendRequire arity");
  const target = createRequire(path.join(root, call.origin.file)).resolve(spec,
    { paths: [path.join(root, "server/backend/node_modules"), path.join(root, "node_modules")] });
  return evidence(root, path.relative(root, target).replaceAll("\\", "/"));
}

/** Policy is an exact source/call contract, not an unknown-count or directory whitelist. */
export function certifyBackendDynamicPaths(root, entries, env, { policy = JSON.parse(fs.readFileSync(new URL("./backend-dynamic-path-inputs.json", import.meta.url))), discovery = false } = {}) {
  root = fs.realpathSync(root);
  for (const [name, value] of Object.entries(env)) if (dynamicPathEnvironmentKeys.some(key => key.toUpperCase() === name.toUpperCase()))
    // Storage's backend override preserves whitespace, so even a whitespace-only value
    // is an external root. Do not normalize it into an apparently absent override.
    assert(!String(value || ""), `Default-root certificate cannot cover ${name}`);
  assert(policy.schemaVersion === 1 && policy.purpose === "backend-default-dynamic-path-certification" && policy.productionEnabled === false
    && policy.publishScopeOptimizationEnabled === false, "Invalid dynamic path policy");
  assert.deepEqual(entries, policy.entries, "Dynamic certificate process entries changed");
  assert.deepEqual(policy.sourceContracts.map(({ file, selector }) => ({ file, selector })), dynamicPathContractFiles, "Incomplete source contracts");
  const contracts = policy.sourceContracts.map(row => {
    const actual = sharedLoaderSourceSignature(row.file, fs.readFileSync(safe(root, row.file).real, "utf8"), row.selector);
    assert.equal(actual, row.signature, `Loader interpretation changed: ${row.file}`); return { ...row, matched: true };
  });
  const manifestFiles = ["packages/shared/catalog/venue_manifest.json", `${registry}/manifest.json`, `${runtime}/registry/manifest.json`];
  const manifestBytes = manifestFiles.map(file => fs.readFileSync(safe(root, file).real));
  assert(manifestBytes.every(bytes => bytes.equals(manifestBytes[0])), "Registry catalog copies differ");
  const manifest = JSON.parse(manifestBytes[0]);
  assert(manifest.every(row => /^[a-zA-Z0-9_-]+$/.test(row.dir)), "Unsafe manifest directory");
  assert.equal(new Set(manifest.map(row => row.id.toUpperCase())).size, manifest.length, "Duplicate manifest IDs");
  assert.equal(new Set(manifest.map(row => row.dir)).size, manifest.length, "Duplicate manifest directories");
  const preloadFiles = [], packages = [];
  for (const entry of manifest) {
    const pkg = `${probes}/${entry.dir}/package.json`;
    if (!fs.existsSync(path.join(root, pkg))) continue;
    const row = evidence(root, pkg), data = JSON.parse(fs.readFileSync(safe(root, pkg).real, "utf8")); packages.push({ ...row, module: data.type === "module" });
    if (data.type !== "module") continue;
    for (const name of fs.readdirSync(path.join(root, probes, entry.dir)).sort())
      if (name.endsWith(".js") && !name.startsWith("_") && fs.statSync(path.join(root, probes, entry.dir, name)).isFile()) preloadFiles.push(evidence(root, `${probes}/${entry.dir}/${name}`));
  }
  if (!discovery) assert.deepEqual(preloadFiles.map(row => row.file), policy.preloadFiles, "Default preload inventory changed");
  const pg = pgFiles.map(file => {
    const searchPaths = ["apps/backend/node_modules", "node_modules", "server/node_modules"];
    const target = createRequire(path.join(root, file)).resolve("pg", { paths: searchPaths.map(dir => path.join(root, dir)) });
    return { importer: file, searchPaths, ...evidence(root, path.relative(root, target).replaceAll("\\", "/")) };
  });
  const cache = new Map(), seeds = new Set([`${runtime}/registry/paths.js`, `${runtime}/registry/feeds.js`, ...helpers, ...preloadFiles.map(row => row.file)]);
  let graph, bindings, targets;
  for (let pass = 0; pass < 12; pass++) {
    graph = captureBackendResolution(root, entries, env, { additionalFiles: [...seeds], cache });
    assert.deepEqual(graph.unresolved, [], "Unresolved expanded runtime dependency");
    for (const file of graph.files) safe(root, file);
    const selectors = new Map(contracts.map(row => [row.file, row.selector]));
    const files = Object.fromEntries(graph.files.map(file => [file, bindingSource(file, fs.readFileSync(safe(root, file).real, "utf8"), selectors.get(file))]));
    const dependencies = graph.resolutions.filter(row => !row.assetType).map(row => ({ ...row, targets: [row.target] }));
    bindings = analyzePmLoaderBindings({ files, dependencies, origins: dynamicPathOrigins,
      expectedCalls: discovery ? [] : policy.calls,
      reviewedAcquisition: file => selectors.has(file) });
    const problems = discovery ? bindings.violations.filter(row => row.rule !== "pm-loader-call")
      : bindings.violations.filter(row => !(row.rule === "pm-loader-call" && row.pattern === "source-bound loader call disappeared, changed source/arguments, or changed count"));
    assert.deepEqual(problems, [], "Unbounded loader capability flow");
    targets = bindings.calls.map(call => ({ call, ...resolveRequest(root, call, manifest) }));
    let changed = false;
    for (const row of targets) if (!row.target.includes("node_modules/") && /\.[cm]?[jt]s$/.test(row.target) && !graph.files.includes(row.target)) { seeds.add(row.target); changed = true; }
    if (!changed) break;
    assert(pass < 11, "Dynamic dependency expansion failed to converge");
  }
  if (!discovery) assert.deepEqual(bindings.violations, [], "Source-bound runtime calls changed");
  const raw = captureBackendResolution(root, entries, env, { cache });
  const unknownSites = graph.unknown.map(({ line, ...row }) => JSON.parse(JSON.stringify(row))).sort((a, b) => key(a).localeCompare(key(b)));
  if (!discovery) assert.deepEqual(unknownSites, policy.dynamicSites, "New, missing or changed dynamic input");
  for (const row of graph.unknown) assert(contracts.some(contract => contract.file === row.file), `Unreviewed dynamic implementation: ${row.file}`);
  const expandedRecords = graph.unknown.map(row => {
    let proof;
    if (pgFiles.includes(row.file)) proof = { kind: "fixed-pg-target", targets: pg.filter(item => item.importer === row.file) };
    else if (row.expression === "pathsUrl" || row.expression === "feedsUrl") proof = { kind: "default-registry", targets: [evidence(root, `${runtime}/registry/${row.expression === "pathsUrl" ? "paths" : "feeds"}.js`)] };
    else if (row.expression === "pathToFileURL(abs).href") proof = { kind: "manifest-esm-preload", targets: preloadFiles };
    else if (row.expression === "abs") proof = { kind: "source-bound-platform-requests", targets: targets.filter(item => item.call.origin.symbol === "requirePlatform") };
    else if (row.expression === "path.join(getAdapterRoot(), ...segments)") proof = { kind: "generic-branch-unreachable", calls: bindings.calls.filter(item => item.origin.file === central && item.origin.symbol === "adapterRequire"), genericCalls: 0 };
    else if (["entry", "specifier", "require.resolve(entry, { paths: RESOLVE_PATHS })", "require.resolve(specifier, { paths: RESOLVE_PATHS })"].includes(row.expression)) {
      const symbol = row.expression.includes("specifier") ? "backendRequire" : "reqS";
      const calls = bindings.calls.filter(item => item.origin.file === row.file && item.origin.symbol === symbol);
      proof = { kind: calls.length ? "source-bound-package-requests" : "parameter-port-unused", calls,
        targets: targets.filter(item => item.call.origin.file === row.file && item.call.origin.symbol === symbol) };
    }
    assert(proof && [central, ...helpers, ...pgFiles].includes(row.file), `Missing dynamic proof: ${row.file}:${row.expression}`);
    if (proof.kind === "parameter-port-unused") assert.equal(proof.calls.length, 0, "Previously unused central parameter port is now used");
    return { ...row, certified: true, proof };
  });
  const records = raw.unknown.map(row => {
    const record = expandedRecords.find(item => key(item) === key(row)); assert(record, "Original dynamic input disappeared during expansion"); return record;
  });
  for (const row of pg) assert(graph.resolutions.filter(site => site.file === row.importer && site.spec === "pg").every(site => site.target === row.target), "PG literal and custom-search resolver identities differ");
  return { schemaVersion: 1, assumption: "Fresh eight-process installation; default workspace roots; no environment or programmatic root override",
    sourceContracts: contracts, entries, rawDynamicSites: raw.unknown, records, expandedDynamicSites: graph.unknown, expandedRecords,
    preloadFiles, preloadPackages: packages, manifests: manifestFiles.map(file => evidence(root, file)), pg,
    bindings: { calls: bindings.calls, reviewedCalls: groupCalls(bindings.calls) }, targets, graph,
    inputEvidence: graph.files.map(file => evidence(root, file)),
    uncertified: [], defaultProjectClosureCertified: !discovery, externalDependencyInternalsCertified: false,
    productionEnvironmentCertified: false, productionEnabled: false, publishScopeOptimizationEnabled: false,
    servicesExecuted: false, limitations: ["External SDK internals are represented by installed target/package identity, not recursively certified.",
      "Overrides and packaged/external roots require a separate certificate; application .env and production state are not inspected."] };
}

export function assertDynamicPathParity(full, selected) {
  assert(full.defaultProjectClosureCertified && selected.defaultProjectClosureCertified, "Missing default-root certification");
  assert.deepEqual(full.uncertified, []); assert.deepEqual(selected.uncertified, []);
  assert.deepEqual(selected, full, "Dynamic roots, calls, preload inventory or target identities differ in isolated installation");
}
