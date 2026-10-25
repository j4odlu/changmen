// [changmen 扩展] Source/metadata tests; no trading modules are executed or rewritten.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, expect, it } from "vitest";
import { checkPmVuePeer, comparePmDynamicSites, inspectPmDependencies, installedPmDependency, pmNodeBrowserLoaderTarget } from "./pm-dependency-audit.mjs";
import { componentImportSites } from "./component-entry-boundary.mjs";

const scratch = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) {
    if (path.dirname(dir) !== path.resolve(os.tmpdir()) || !path.basename(dir).startsWith("changmen-pm-dependencies-")) throw Error("Unexpected cleanup path");
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
const site = { file: "pm/book.ts", kind: "dynamic-import", spec: "./worker", line: 7 };
const expected = [{ ...site, count: 1 }];
it("rejects moved browser implementations through custom Node loader requests", () => {
  for (const [loader, args] of [["adapterRequire", ["browser", "pm-book-diagnostics", "bookRuntime.ts"]],
    ["backendRequire", ["@changmen/venue-adapter/browser/pm-book-diagnostics"]]]) {
    expect(pmNodeBrowserLoaderTarget({ environment: "node", kind: "custom-loader", loader, arguments: args })).toContain("/browser/");
  }
});
it("accepts exactly reviewed literal targets without relying on line numbers", () => {
  expect(comparePmDynamicSites([{ ...site, line: 99 }], expected)).toEqual([]);
});
for (const [name, actual] of [
  ["new literal target", [site, { ...site, spec: "./other" }]],
  ["computed target", [{ ...site, spec: null }]],
  ["missing target", []],
  ["duplicate call", [site, site]],
  ["redirected target", [{ ...site, spec: "../node" }]],
  ["changed load kind", [{ ...site, kind: "module-url" }]],
]) it(`rejects ${name}`, () => expect(comparePmDynamicSites(actual, expected).length).toBeGreaterThan(0));
it("does not permit duplicate or computed registrations as exceptions", () => {
  expect(() => comparePmDynamicSites([site], [...expected, ...expected])).toThrow("Invalid PM dynamic registration");
  expect(() => comparePmDynamicSites([], [{ ...site, spec: null, count: 1 }])).toThrow("Invalid PM dynamic registration");
});
for (const [loaderSymbol, args] of [
  ["requirePlatform", ["Polymarket", "orderBook.ts"]],
  ["adapterRequire", ["polymarket", "orderBook.ts"]],
  ["backendRequire", ["@changmen/venue-adapter/polymarket/orderBook"]],
  ["backendRequire", ["@changmen/venue-adapter/registry/adapters"]],
  ["backendRequire", ["@changmen/pm-market-data-browser"]],
  ["backendRequire", ["@changmen/pm-market-data-browser/service"]],
  ["backendRequire", ["@changmen/venue-browser"]],
  ["backendRequire", ["@changmen/venue-browser/pm-book-source"]],
  ["backendRequire", ["@changmen/venue-browser/polymarket/pmTickState"]],
  ["adapterRequire", ["..", "pm-market-data-browser", "src/index.ts"]],
  ["adapterRequire", ["..", "..", "client", "packages", "pm-market-data-browser", "src/index.ts"]],
  ["requirePlatform", ["Polymarket", "../../pm-market-data-browser/src/index.ts"]],
]) it(`rejects explicit PM browser requests through ${loaderSymbol}(${args.join(",")})`, () => {
  expect(pmNodeBrowserLoaderTarget({ environment: "node", kind: "custom-loader", loader: "alias", loaderSymbol, arguments: args })).toBeTruthy();
});
it("retains loader identity across aliases and does not treat other Node platforms as PM browser imports", () => {
  const sites = componentImportSites("server/test.js", 'import { requirePlatform as load } from "./loader.js"; const alias = load; alias("Polymarket", "orderBook.ts");', ["requirePlatform"]);
  const call = sites.find(site => site.kind === "custom-loader");
  expect(call.loaderSymbol).toBe("requirePlatform");
  expect(pmNodeBrowserLoaderTarget({ ...call, environment: "node" })).toBeTruthy();
  expect(pmNodeBrowserLoaderTarget({ ...call, environment: "browser" })).toBeNull();
  expect(pmNodeBrowserLoaderTarget({ ...call, environment: "node", arguments: ["PB", "node", "session.js"] })).toBeNull();
  expect(pmNodeBrowserLoaderTarget({ ...call, environment: "node", arguments: ["Polymarket", "node", "session.js"] })).toBeNull();
});
function installation() {
  const root = fs.mkdtempSync(path.join(path.resolve(os.tmpdir()), "changmen-pm-dependencies-")); scratch.push(root);
  const write = (file, value) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), typeof value === "string" ? value : JSON.stringify(value));
  };
  write("package.json", {}); write("packages/adapter/package.json", { name: "adapter" });
  write("packages/adapter/auth.ts", 'throw new Error("do not run");');
  write("node_modules/test-sdk/package.json", { name: "test-sdk", version: "1.0.0", exports: { "./hmac": { import: "./esm.js", require: "./index.js" } } });
  write("node_modules/test-sdk/index.js", 'throw new Error("do not run");');
  write("node_modules/test-sdk/esm.js", 'throw new Error("do not run");');
  const lock = { packages: { "node_modules/test-sdk": { version: "1.0.0", integrity: "test-integrity" } } };
  return { root, write, lock, inspect: spec => installedPmDependency(root, "packages/adapter/auth.ts", spec || "test-sdk/hmac", lock) };
}
it("records a usable locked transitive dependency as undeclared, without executing it", () => {
  const f = installation(), fact = f.inspect();
  expect(fact.lockVersionMatches).toBe(true); expect(fact.specifierTargetExists).toBe(true);
  expect(fact.declaredRuntime).toBe(false); expect(fact.owner).toBe("packages/adapter/package.json");
  expect(fact.browserExportSelectionCertified).toBe(false); expect(fact.installationClosureCertified).toBe(false);
});
it("does not explain a missing subpath merely because its package is installed", () => {
  const f = installation();
  expect(f.inspect("test-sdk/missing").lockVersionMatches).toBe(true);
  expect(f.inspect("test-sdk/missing").specifierTargetExists).toBe(false);
});
it("sees import-only export files without treating require resolution as browser proof", () => {
  const f = installation(); f.write("node_modules/test-sdk/package.json", { name: "test-sdk", version: "1.0.0", exports: { "./hmac": { import: "./esm.js" } } });
  expect(f.inspect().nodeRequireTarget).toBeUndefined();
  expect(f.inspect().specifierTargetExists).toBe(true);
  expect(f.inspect().browserExportSelectionCertified).toBe(false);
});
it("rejects installation/lock version disagreement as evidence", () => {
  const f = installation(); f.lock.packages["node_modules/test-sdk"].version = "2.0.0";
  expect(f.inspect().lockVersionMatches).toBe(false);
});
it("records the nearest installed copy and exact owning workspace rather than a root copy", () => {
  const f = installation();
  f.write("packages/adapter/node_modules/test-sdk/package.json", { name: "test-sdk", version: "2.0.0", exports: { "./hmac": "./index.js" } });
  f.write("packages/adapter/node_modules/test-sdk/index.js", "");
  f.lock.packages["packages/adapter/node_modules/test-sdk"] = { version: "2.0.0" };
  f.write("packages/adapter/package.json", { name: "adapter", peerDependencies: { "test-sdk": "2.0.0" } });
  const fact = f.inspect();
  expect(fact.installedVersion).toBe("2.0.0"); expect(fact.lockVersionMatches).toBe(true);
  expect(fact.declaration).toBe("peerDependencies"); expect(fact.declaredRuntime).toBe(true);
});
it("PM imports have declarations and a Vue host peer while inherited uncertainty remains explicit", () => {
  const report = inspectPmDependencies(fileURLToPath(new URL("../../", import.meta.url)));
  expect(report.violations).toEqual([]); expect(report.dynamicSites).toHaveLength(48);
  expect(report.dynamicSites.filter(site => site.file === "client/packages/venue-browser/polymarket/auth/credentials.ts")
    .map(site => site.spec).sort()).toEqual(["../wallet/polygonRpc", "@polymarket/client/viem", "viem", "viem/accounts"]);
  expect(report.dynamicSites.some(site => site.file === "server/backend/core/integrations/polymarket/clob_l1.js")).toBe(false);
  expect(report.unknownSummary).toEqual({ raw: 20, primary: 0, explainedPrimary: 0, unexplainedPrimary: 0, inherited: 20 });
  expect(report.sharedLoaderEvidence.byClass).toEqual({ "fixed-target": 12, "environment-dependent": 3, "parameter-unknown": 5 });
  expect(report.loaderBindings.calls).toHaveLength(9);
  expect(report.loaderBindings.safeToNarrowPublishScope).toBe(false);
  expect(report.sourceFiles.some(file => file.startsWith("server/backend/scripts/"))).toBe(false);
  expect(report.sourceFiles.filter(file => file.startsWith("devtools/"))).toEqual(["devtools/runtime-tooling/dev_web_port.js"]);
  expect(report.undeclaredRuntimeDependencies).toEqual([]);
  expect(report.externalDependencies.find(fact => fact.owner === "client/packages/pm-market-data-browser/package.json"))
    .toMatchObject({ spec: "@polymarket/client/actions", typeOnly: true, declaredDevelopment: true });
  expect(report.externalDependencies.find(fact => fact.name === "vue" && fact.owner === "client/packages/venue-browser/package.json"))
    .toMatchObject({ declaration: "peerDependencies", peerOptional: true, declarationRange: "^3.5.13" });
  expect(report.sharedExternalPackages).toEqual(["@polymarket/client"]);
  expect(report.safeToNarrowPublishScope).toBe(false);
}, 60_000); // Full graph scans take up to 32 seconds on the shared CI runner.
it("does not classify a later runtime use as type-only or merge different SDK subpaths", () => {
  const read = fs.readFileSync;
  let report;
  try {
    fs.readFileSync = function(file, ...args) {
      const value = read.call(this, file, ...args);
      return typeof value === "string" && String(file).replaceAll("\\", "/").endsWith("/client/packages/pm-market-data-browser/src/bookReducer.ts")
        ? value + '\nimport type { Example } from "@polymarket/client";\nimport { Example } from "@polymarket/client";\n' : value;
    };
    report = inspectPmDependencies(fileURLToPath(new URL("../../", import.meta.url)));
  } finally { fs.readFileSync = read; }
  const facts = report.externalDependencies.filter(fact => fact.owner === "client/packages/pm-market-data-browser/package.json");
  expect(facts.find(fact => fact.spec === "@polymarket/client/actions").typeOnly).toBe(true);
  expect(facts.find(fact => fact.spec === "@polymarket/client").typeOnly).toBe(false);
  expect(report.undeclaredRuntimeDependencies.some(fact => fact.spec === "@polymarket/client")).toBe(true);
  expect(report.violations.some(row => row.pattern.includes("isolated browser core"))).toBe(true);
}, 60_000);
it("requires the browser package to declare its SDK type dependency instead of borrowing the adapter host", () => {
  const read = fs.readFileSync;
  let report;
  try {
    fs.readFileSync = function(file, ...args) {
      const value = read.call(this, file, ...args);
      if (typeof value !== "string" || !String(file).replaceAll("\\", "/").endsWith("/client/packages/pm-market-data-browser/package.json")) return value;
      const pkg = JSON.parse(value); delete pkg.devDependencies; return JSON.stringify(pkg);
    };
    report = inspectPmDependencies(fileURLToPath(new URL("../../", import.meta.url)));
  } finally { fs.readFileSync = read; }
  expect(report.violations.some(row => row.rule === "pm-direct-dependency" && row.file === "client/packages/pm-market-data-browser/package.json")).toBe(true);
}, 60_000);
it("rejects private Vue runtimes, missing/required peers and a host range mismatch", () => {
  const peer = { peerDependencies: { vue: "^3.5.13" }, peerDependenciesMeta: { vue: { optional: true } } };
  const host = { dependencies: { vue: "^3.5.13" } };
  expect(checkPmVuePeer(peer, host)).toEqual([]);
  for (const bad of [{}, { ...peer, dependencies: { vue: "^3.5.13" } }, { ...peer, peerDependenciesMeta: {} },
    { ...peer, peerDependencies: { vue: "^3.6.0" } }]) expect(checkPmVuePeer(bad, host).length).toBeGreaterThan(0);
});

for (const [name, file, addition, diagnostic] of [
  ["computed PM input", "client/packages/venue-browser/adapter/polymarket/orderBook.ts", "void import(globalThis.unknownInput);", "[pm-dynamic-input]"],
  ["Node loader reaching a browser implementation", "server/backend/core/account/balance_provider.js", 'requirePlatform("Polymarket", "orderBook.ts");', "[pm-node-browser-loader]"],
  ["namespace loader with unknown arguments", "server/backend/core/esport-api/store.js", 'import * as auditLoader from "../shared/adapter_paths.js";auditLoader.backendRequire(globalThis.unknownModule);', "[pm-loader-unknown]"],
  ["namespace loader reaching PM browser", "server/backend/core/esport-api/store.js", 'import * as auditLoader from "../shared/adapter_paths.js";auditLoader.requirePlatform("Polymarket","orderBook.ts");', "[pm-node-browser-loader]"],
  ["opaque module acquisition in preload", "server/platform-probes/ray/ws.js", "void import(globalThis.unknownPreload);", "[pm-loader-unknown]"],
  ["changed loader interpretation", "server/venues/loader/adapter_paths.mjs", "void 0;", "[pm-shared-loader]"],
]) it(`daily boundary CLI rejects ${name} without a historical audit`, () => {
  const code = `import fs from "node:fs";const read=fs.readFileSync;
    fs.readFileSync=function(file,...args){const value=read.call(this,file,...args);
      return typeof value==="string"&&String(file).replaceAll("\\\\","/").endsWith(${JSON.stringify('/'+file)})
        ? value+${JSON.stringify('\n'+addition+'\n')}:value;};await import("./scripts/check-team-boundaries.mjs");`;
  const result=spawnSync(process.execPath,["--input-type=module","--eval",code],{
    cwd:fileURLToPath(new URL("../../",import.meta.url)),encoding:"utf8",timeout:35000,maxBuffer:2*1024*1024,
    env:{...process.env,CHANGMEN_HISTORICAL_AUDIT:""},windowsHide:true});
  expect(result.status,result.stderr).toBe(1);
  expect(result.stderr).toContain(diagnostic);
  expect(result.stderr).toContain(file);
},40000);

it("daily CLI accepts an equivalent namespace rewrite and still checks the current dependency graph",()=>{
  const code=`import fs from "node:fs";const read=fs.readFileSync;
    fs.readFileSync=function(file,...args){const source=read.call(this,file,...args);
      return typeof source==="string"&&String(file).replaceAll("\\\\","/").endsWith("/server/platform-probes/ray/ws.js")
        ?source.replace('import { backendRequire }','import * as boundLoader').replace('backendRequire("socketcluster-client")','boundLoader.backendRequire("socketcluster-client")'):source;};
    await import("./scripts/check-team-boundaries.mjs");`;
  const result=spawnSync(process.execPath,["--input-type=module","--eval",code],{
    cwd:fileURLToPath(new URL("../../",import.meta.url)),encoding:"utf8",timeout:35000,maxBuffer:2*1024*1024,
    env:{...process.env,CHANGMEN_HISTORICAL_AUDIT:""},windowsHide:true});
  expect(result.status,result.stderr).toBe(0);
  expect(result.stdout).toContain("check-team-boundaries: OK");
},40000);

for (const [file, transform, diagnostic] of [
  ["client/packages/venue-browser/package.json", 'const p=JSON.parse(source);delete p.dependencies["@noble/hashes"];return JSON.stringify(p);', "[pm-direct-dependency]"],
  ["scripts/verification/pm-loader-binding-inputs.json", 'const p=JSON.parse(source);p.origins=p.origins.filter(row=>row.symbol!=="reqS");return JSON.stringify(p);', "Incomplete or redirected PM loader binding policy"],
]) it(`daily CLI rejects a weakened current policy: ${file}`,()=>{
  const code=`import fs from "node:fs";const read=fs.readFileSync;
    fs.readFileSync=function(file,...args){const source=read.call(this,file,...args);
      if(typeof source!=="string"||!String(file).replaceAll("\\\\","/").endsWith(${JSON.stringify('/'+file)}))return source;
      ${transform}};await import("./scripts/check-team-boundaries.mjs");`;
  const result=spawnSync(process.execPath,["--input-type=module","--eval",code],{
    cwd:fileURLToPath(new URL("../../",import.meta.url)),encoding:"utf8",timeout:35000,maxBuffer:2*1024*1024,
    env:{...process.env,CHANGMEN_HISTORICAL_AUDIT:""},windowsHide:true});
  expect(result.status,result.stderr).toBe(1);expect(result.stderr).toContain(diagnostic);
},40000);
