import { beforeAll, expect, it } from "vitest";
import fs from "node:fs";
import { backendInstallProfile } from "../deploy/backend-install-profile.mjs";
import { certifyBackendDynamicPaths, assertDynamicPathParity, dynamicPathEnvironmentKeys } from "./backend-dynamic-paths.mjs";
import { analyzePmLoaderBindings } from "./pm-loader-bindings.mjs";

const root = process.cwd(), entries = backendInstallProfile(root).entries;
const policy = JSON.parse(fs.readFileSync(new URL("./backend-dynamic-path-inputs.json", import.meta.url)));
const env = { ...process.env, NODE_OPTIONS: "", NODE_PATH: "" };
let certificate;
beforeAll(() => { certificate = certifyBackendDynamicPaths(root, entries, env); }, 120000);

it("certifies all original dynamic sites and the recursively expanded default project inputs", () => {
  expect(certificate.records).toHaveLength(11);
  expect(certificate.expandedRecords).toHaveLength(19);
  expect(certificate.bindings.calls).toHaveLength(22);
  expect(certificate.preloadFiles).toHaveLength(20);
  expect(certificate.uncertified).toEqual([]);
  expect(certificate.graph.unresolved).toEqual([]);
  expect(certificate.defaultProjectClosureCertified).toBe(true);
  expect(certificate.externalDependencyInternalsCertified).toBe(false);
  expect(certificate.productionEnvironmentCertified).toBe(false);
  expect(certificate.expandedRecords.every(row => row.certified && row.proof)).toBe(true);
  expect(certificate.graph.files).toContain("server/platform-probes/hg/session.js");
  expect(certificate.graph.files.some(file => file.startsWith("client/") || file.startsWith("packages/venue-adapter/"))).toBe(false);
});

it("rejects external root overrides/search hooks, changed processes and changed loader interpretation", () => {
  for (const name of dynamicPathEnvironmentKeys) expect(() => certifyBackendDynamicPaths(root, entries, { ...env, [name]: "uninspected" })).toThrow(/cannot cover/);
  expect(() => certifyBackendDynamicPaths(root, entries, { ...env, CHANGMEN_BACKEND_ROOT: " " })).toThrow(/cannot cover/);
  expect(() => certifyBackendDynamicPaths(root, entries, { ...env, node_options: "--require=external" })).toThrow(/cannot cover/);
  expect(() => certifyBackendDynamicPaths(root, entries.slice(1), env)).toThrow(/process entries changed/);
  const changed = structuredClone(policy); changed.sourceContracts[0].signature = "0".repeat(64);
  expect(() => certifyBackendDynamicPaths(root, entries, env, { policy: changed })).toThrow(/interpretation changed/);
});

it("parity fails on dropped uncertainty/proofs, SDK identity changes and missing expanded targets", () => {
  expect(() => assertDynamicPathParity(certificate, structuredClone(certificate))).not.toThrow();
  for (const mutate of [r => r.records.pop(), r => r.expandedRecords.pop(), r => r.targets.pop(),
    r => { r.targets[0].sha256 = "changed"; }, r => { r.pg[0].version = "changed"; },
    r => r.preloadFiles.pop(), r => r.graph.files.pop(), r => r.bindings.calls.pop(),
    r => r.uncertified.push({ expression: "new" }), r => { r.defaultProjectClosureCertified = false; }]) {
    const selected = structuredClone(certificate); mutate(selected);
    expect(() => assertDynamicPathParity(certificate, selected)).toThrow();
  }
});

it("tracks aliases to their implementation and rejects computed, escaping and mutated loader capabilities", () => {
  const origin = { file: "loader.mjs", symbol: "requirePlatform" };
  const inspect = source => analyzePmLoaderBindings({ files: { "loader.mjs": "export function requirePlatform(...args) {}", "main.mjs": source },
    dependencies: [{ file: "main.mjs", spec: "./loader.mjs", targets: ["loader.mjs"] }], origins: [origin],
    expectedCalls: [{ file: "main.mjs", origin, arguments: ["HG", "node", "session.js"], count: 1 }] });
  expect(inspect("import { requirePlatform as load } from './loader.mjs'; const alias=load; alias('HG','node','session.js');").violations).toEqual([]);
  for (const source of [
    "import {requirePlatform as load} from './loader.mjs'; load(platform,'node','session.js');",
    "import * as loaders from './loader.mjs'; loaders[name]('HG','node','session.js');",
    "import {requirePlatform as load} from './loader.mjs'; schedule(load);",
    "import * as loaders from './loader.mjs'; loaders.requirePlatform=other;",
  ]) expect(inspect(source).violations.length).toBeGreaterThan(0);
});
