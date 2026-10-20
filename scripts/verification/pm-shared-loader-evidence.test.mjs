// [changmen 扩展] Review evidence only: never import production loaders or open a database.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, expect, it } from "vitest";
import { inspectPmDependencies } from "./pm-dependency-audit.mjs";
import { inspectPmSharedLoaders, sharedLoaderSourceSignature } from "./pm-shared-loader-evidence.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = file => fs.readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const policy = JSON.parse(source("scripts/verification/pm-shared-loader-inputs.json"));
let sites, evidence;
beforeAll(() => {
  const report = inspectPmDependencies(root);
  sites = report.inheritedUnknowns;
  evidence = report.sharedLoaderEvidence;
}, 60_000); // This hook scans the complete graph, including all retained unknowns.
const inspect = (actual = sites, options = {}) => inspectPmSharedLoaders(root, actual, { env: {}, ...options });

it("classifies the actual PM closure while retaining every original unknown", () => {
  expect(sites).toHaveLength(20);
  expect(evidence.records).toHaveLength(20);
  expect(evidence.byClass).toEqual({ "fixed-target": 12, "environment-dependent": 3, "parameter-unknown": 5 });
  expect(evidence.violations).toEqual([]);
  expect(evidence.records.every(row => row.closed === false)).toBe(true);
  expect(evidence.sourceContracts).toHaveLength(7);
  expect(evidence.sourceContracts.every(row => row.matched)).toBe(true);
  expect(evidence.runtimeRootsCertified).toBe(false);
  expect(evidence.safeToNarrowPublishScope).toBe(false);
  expect(evidence.publishScopeOptimizationEnabled).toBe(false);
});
it("records default target hashes, locked pg resolution and the bounded preload inventory without executing them", () => {
  const result = inspect().defaultScenario;
  expect(result.applicableToAuditorProcess).toBe(true);
  expect(result.targetEvidence.map(row => row.file).sort()).toEqual([
    "server/platform-probes/hg/session.js", "server/platform-probes/ob/session.js",
    "server/platform-probes/pb/session.js", "server/platform-probes/ray/core.js",
    "server/platform-probes/ray/session.js", "server/venues/registry/runtime/registry/feeds.js",
    "server/venues/registry/runtime/registry/paths.js",
  ].sort());
  for (const row of [...result.targetEvidence, ...result.preloadPackages, ...result.preloadFiles, result.pg, result.manifest]) {
    expect(row.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(row.realFile).not.toMatch(/^\.\.\//);
  }
  const lock = JSON.parse(source("package-lock.json"));
  expect(result.pg.version).toBe(lock.packages[result.pg.lockKey].version);
  expect(result.pg.searchPaths).toEqual(["apps/backend/node_modules", "node_modules", "server/node_modules"]);
  expect(result.preloadFiles.length).toBeGreaterThan(0);
  expect(result.preloadFiles.every(row => /^server\/platform-probes\/[^/]+\/[^/_][^/]*\.js$/.test(row.file))).toBe(true);
  expect(result.runtimeExecuted).toBe(false);
  expect(result.moduleDependencyClosuresCertified).toBe(false);
});
it("keeps three generic APIs open even though this recognized PM call set does not instantiate them", () => {
  expect(inspect().defaultScenario.recognizedRequests).toEqual({ requirePlatform: 5, adapterRequireRegistryFastPath: 1, reqS: 0, backendRequire: 0, adapterRequireGeneric: 0 });
  const unknowns = evidence.records.filter(row => row.classification === "parameter-unknown");
  expect(unknowns).toHaveLength(5);
  expect(unknowns.every(row => row.targetNameDetermined === false && row.closed === false)).toBe(true);
});
for (const [name, mutate] of [
  ["a new shared computed call", rows => [...rows, { file: "server/backend/core/account/balance_provider.js", kind: "custom-loader", loaderSymbol: "reqS", expression: "runtimeInput", arguments: [null] }]],
  ["a redirected literal target", rows => rows.map(row => row.loaderSymbol === "adapterRequire" ? { ...row, arguments: ["polymarket", "orderBook.ts"] } : row)],
  ["a duplicated record", rows => [...rows, rows[0]]],
  ["a missing record", rows => rows.slice(1)],
]) it(`rejects ${name} rather than dropping or accepting uncertainty`, () => {
  const result = inspect(mutate(sites));
  expect(result.violations.length).toBeGreaterThan(0);
  expect(result.defaultScenario).toBeUndefined();
  expect(result.safeToNarrowPublishScope).toBe(false);
});
for (const key of ["CHANGMEN_ADAPTER_ROOT", "GAMEBET_ADAPTER_ROOT", "CHANGMEN_PLATFORM_PROBES_ROOT", "GAMEBET_NODE_ROOT", "CHANGMEN_BACKEND_ROOT", "NODE_PATH", "NODE_OPTIONS"]) {
  it(`marks ${key} coverage as unverified without reading or printing an external value`, () => {
    const secret = "Z:/never-read-this-external-root/private-value";
    const result = inspect(sites, { env: { [key]: secret } });
    expect(result.environmentPolicies.some(row => row.processConfiguredKeys.includes(key))).toBe(true);
    expect(result.environmentPolicies.every(row => row.externalContentsInspected === false)).toBe(true);
    expect(result.defaultScenario.applicableToAuditorProcess).toBe(false);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(result.runtimeRootsCertified).toBe(false);
  });
}
it("does not certify application .env or remote configuration from an empty auditor environment", () => {
  const result = inspect();
  expect(result.environmentSource).toContain("application .env and remote environment are not loaded");
  expect(result.runtimeRootsCertified).toBe(false);
});
it("ignores comment and whitespace edits for this extra interpretation check, leaving the separate exact FOK protection intact", () => {
  const file = "server/venues/loader/adapter_paths.mjs", text = source(file);
  expect(sharedLoaderSourceSignature(file, `// added comment\n${text}\n  /* comment */`)).toBe(sharedLoaderSourceSignature(file, text));
});
it("keeps code after template substitutions and regular expressions in the source contract", () => {
  const text = 'const name = `root/${value}`; const ok = /root/.test(name); use("pg");';
  const signature = sharedLoaderSourceSignature("example.js", text);
  expect(sharedLoaderSourceSignature("example.js", `${text}\n// comment`)).toBe(signature);
  expect(sharedLoaderSourceSignature("example.js", text.replace('use("pg")', 'use("other")'))).not.toBe(signature);
  expect(sharedLoaderSourceSignature("example.js", text.replace('/root/', '/different/'))).not.toBe(signature);
});
it("binds pg module/search selection without treating unrelated DB business functions as loader inputs", () => {
  const file = "rds/pg_pool.js", text = source(file);
  const signature = sharedLoaderSourceSignature(file, text, "pg-loader");
  expect(sharedLoaderSourceSignature(file, `${text}\nfunction unrelatedQuery() { return 1; }`, "pg-loader")).toBe(signature);
  expect(sharedLoaderSourceSignature(file, text.replace('"pg", { paths:', '"other-db", { paths:'), "pg-loader")).not.toBe(signature);
  expect(sharedLoaderSourceSignature(file, text.replace('"apps", "backend"', '"other", "backend"'), "pg-loader")).not.toBe(signature);
});
for (const [file, change] of [
  ["server/venues/loader/adapter_paths.mjs", text => `${text}\nvoid 0;`],
  ["server/venues/registry/paths.js", text => `${text}\nvoid 0;`],
  ["rds/pg_pool.js", text => text.replace('"pg", { paths:', '"other-db", { paths:')],
]) it(`invalidates classifications when the reviewed rules change in ${file}`, () => {
  const result = inspect(sites, { readSource: name => name === file ? change(source(name)) : source(name) });
  expect(result.violations.some(row => row.file === file && row.rule === "pm-shared-loader")).toBe(true);
  expect(result.records.every(row => row.classification === "unreviewed" && row.targetNameDetermined === false)).toBe(true);
  expect(result.defaultScenario).toBeUndefined();
});
it("rejects incomplete policy, duplicate registrations, target/argument disagreement and publish permission", () => {
  for (const modified of [
    { ...policy, sourceContracts: [] },
    { ...policy, records: [...policy.records, policy.records[0]] },
    { ...policy, records: policy.records.map(row => row.target?.request ? { ...row, target: { request: ["elsewhere"] } } : row) },
    { ...policy, publishScopeOptimizationEnabled: true },
  ]) expect(() => inspect(sites, { policy: modified })).toThrow();
});
it("rejects unparseable or incomplete source contracts", () => {
  expect(() => sharedLoaderSourceSignature("bad.js", "function (" )).toThrow("Cannot inspect");
  expect(() => sharedLoaderSourceSignature("bad.js", "const n=1;", "pg-loader")).toThrow("Incomplete PG");
  expect(() => sharedLoaderSourceSignature("bad.js", "", "unknown")).toThrow("Unknown source selector");
});
