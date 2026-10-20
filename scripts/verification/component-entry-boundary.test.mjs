// [changmen 扩展] Isolated repositories; no application code or baseline is rewritten.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { componentImportSites, createComponentInspection, inspectComponentEntries } from "./component-entry-boundary.mjs";

const scratch = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) {
    // Check the exact absolute temp target before recursive removal on Windows.
    if (path.dirname(dir) !== path.resolve(os.tmpdir()) || !path.basename(dir).startsWith("changmen-component-boundary-")) throw Error("Unexpected test cleanup target");
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
function fixture() {
  const root = fs.mkdtempSync(path.join(path.resolve(os.tmpdir()), "changmen-component-boundary-"));
  scratch.push(root);
  const write = (file, content) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), typeof content === "string" ? content : JSON.stringify(content));
  };
  const pkg = { name: "@changmen/mixed", exports: {
    ".": "./registry/index.ts", "./registry/adapters": "./registry/adapters.ts",
    "./book": "./browser/book.ts", "./loader": "./loader.mjs",
  } };
  write("package.json", { workspaces: ["packages/*"] });
  write("packages/mixed/package.json", pkg);
  write("packages/mixed/registry/index.ts", 'export const platforms = ["PM"];');
  write("packages/mixed/registry/adapters.ts", 'export * from "../browser/book";');
  write("packages/mixed/browser/book.ts", "export const book = 1;");
  write("packages/mixed/loader.mjs", "export function adapterRequire(name) { return name; }");
  write("packages/mixed/registry/manifest.json", {});
  write("server/main.mjs", 'import { platforms } from "@changmen/mixed"; void platforms;');
  write("client/web/src/main.ts", 'import { book } from "@changmen/mixed/book"; void book;');
  const manifest = { schemaVersion: 1, purpose: "inventory-and-boundary-only", publishScopeOptimizationEnabled: false,
    nodeRoots: ["server"], nodeOnlyPaths: [], browserRoots: ["client/web/src"], testEntries: [], browserOnlyPaths: ["packages/mixed/browser/"], conservativeInputs: ["package.json"],
    entries: [
      { id: "book", environment: "browser", file: "packages/mixed/browser/book.ts", specifiers: ["@changmen/mixed/book"] },
      { id: "adapters", environment: "browser", file: "packages/mixed/registry/adapters.ts", specifiers: ["@changmen/mixed/registry/adapters"] },
      { id: "registry", environment: "universal", file: "packages/mixed/registry/index.ts", specifiers: ["@changmen/mixed"] },
      { id: "loader", environment: "node", file: "packages/mixed/loader.mjs", specifiers: ["@changmen/mixed/loader"] },
    ],
    dynamicLoaders: [{ file: "packages/mixed/loader.mjs", symbols: ["adapterRequire"], status: "opaque",
      inputs: ["packages/mixed/registry/manifest.json"], reason: "Environment and JSON selected modules remain opaque." }],
  };
  return { root, write, manifest, pkg, inspect: () => inspectComponentEntries(root, manifest) };
}
const book = "packages/mixed/browser/book.ts";

describe("component entry boundaries", () => {
  it("shares reads across expanded graphs without sharing scope-specific inventories", () => {
    const f = fixture();
    f.write("packages/mixed/registry/preload.ts", "export const preload = true;");
    f.manifest.scopes = { pm: { nodeRoots: ["server"], browserRoots: [] } };
    const expanded = { ...f.manifest, scopes: { pm: { nodeRoots: ["server", "packages/mixed/registry"], browserRoots: [] } } };
    const expected = [inspectComponentEntries(f.root, f.manifest, { scope: "pm" }), inspectComponentEntries(f.root, expanded, { scope: "pm" })];
    const inspection = createComponentInspection(f.root);
    expect([inspection.inspect(f.manifest, { scope: "pm" }), inspection.inspect(expanded, { scope: "pm" })]).toEqual(expected);
    expect(expected[0].sourceFiles).not.toContain("packages/mixed/registry/preload.ts");
    expect(expected[1].sourceFiles).toContain("packages/mixed/registry/preload.ts");
    expect(inspection.readSource(book)).toBe("export const book = 1;");
  });
  it("starts a fresh snapshot after source, directory and export changes in the same process", () => {
    const f = fixture();
    expect(f.inspect().violations).toEqual([]);
    f.write("server/injected.mjs", 'import "@changmen/mixed/book";');
    expect(f.inspect().violations.some(v => v.file === "server/injected.mjs")).toBe(true);
    f.write("server/injected.mjs", "");
    f.write("server/main.mjs", 'import "@changmen/mixed/book";');
    expect(f.inspect().violations.some(v => v.file === "server/main.mjs")).toBe(true);
    f.write("server/main.mjs", "");
    f.pkg.exports["."] = "./browser/book.ts";
    f.write("packages/mixed/package.json", f.pkg);
    expect(f.inspect().violations.some(v => v.file === "packages/mixed/registry/index.ts")).toBe(true);
    fs.rmSync(path.join(f.root, book));
    expect(() => f.inspect()).toThrow("Missing component entry");
  });
  it("allows shared registry, browser book and Node loader without relabeling the mixed package", () => {
    const f = fixture(), report = f.inspect();
    expect(report.violations).toEqual([]);
    expect(report.entries.find(entry => entry.id === "book").consumers).toEqual(expect.arrayContaining([expect.objectContaining({ file: "client/web/src/main.ts", usage: "browser-source" })]));
    expect(report.entries.find(entry => entry.id === "registry").consumers).toEqual(expect.arrayContaining([expect.objectContaining({ file: "server/main.mjs", usage: "node-source" })]));
    expect(report.safeToNarrowPublishScope).toBe(false);
    expect(report.unknown).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "loader-contract" })]));
  });
  for (const [name, source] of [
    ["public subpath", 'import "@changmen/mixed/book";'],
    ["browser aggregate inside registry", 'import "@changmen/mixed/registry/adapters";'],
    ["relative normalized path", 'import "../packages/mixed/registry/../browser/book.ts";'],
    ["re-export", 'export * from "@changmen/mixed/book";'],
    ["literal dynamic import", 'void import("@changmen/mixed/book");'],
    ["CommonJS", 'require("@changmen/mixed/book");'],
    ["module.require", 'module.require("@changmen/mixed/book");'],
    ["createRequire alias", 'import { createRequire as make } from "node:module"; const load=make(import.meta.url); load("@changmen/mixed/book");'],
    ["indirect require alias", 'const load2=load1; const load1=require; load2("@changmen/mixed/book");'],
    ["require.resolve", 'require.resolve("@changmen/mixed/book");'],
    ["type import", 'import type { Book } from "@changmen/mixed/book";'],
    ["inline type import", 'type Book = import("@changmen/mixed/book").Book;'],
    ["TypeScript import equals", 'import book = require("@changmen/mixed/book");'],
    ["Vite source alias", 'import "@/main";'],
    ["module URL", 'new URL("../packages/mixed/browser/book.ts", import.meta.url);'],
  ]) it(`rejects Node access through ${name}`, () => {
    const f = fixture(); f.write("server/main.mjs", source);
    expect(f.inspect().violations).toEqual(expect.arrayContaining([expect.objectContaining({ file: "server/main.mjs", rule: "component-entry", pattern: expect.stringContaining("browser-only") })]));
  });
  it("follows shared barrels transitively, reports the whole chain and terminates cycles", () => {
    const f = fixture();
    f.write("server/main.mjs", 'import "../packages/mixed/a.ts";');
    f.write("packages/mixed/a.ts", 'export * from "./b";');
    f.write("packages/mixed/b.ts", 'export * from "./a"; export * from "./browser/book";');
    const hit = f.inspect().violations.find(v => v.file.endsWith("b.ts"));
    expect(hit.trace.map(edge => edge.file)).toEqual(["server/main.mjs", "packages/mixed/a.ts", "packages/mixed/b.ts"]);
    expect(hit.trace.at(-1).target).toBe(book);
  });
  it("checks universal exports even before a Node application imports them", () => {
    const f = fixture(); f.write("server/main.mjs", "");
    f.write("packages/mixed/registry/index.ts", 'export * from "../browser/book";');
    expect(f.inspect().violations.some(v => v.file === "packages/mixed/registry/index.ts")).toBe(true);
  });
  it("allows standalone Node tests to inspect browser code, but a production import of a test cannot bypass the boundary", () => {
    const f = fixture(); f.write("server/book.test.mjs", 'import "@changmen/mixed/book";');
    expect(f.inspect().violations).toEqual([]);
    expect(f.inspect().entries.find(entry => entry.id === "book").consumers.some(item => item.file === "server/book.test.mjs" && item.usage === "test")).toBe(true);
    f.write("server/main.mjs", 'import "./book.test.mjs";');
    const hit = f.inspect().violations.find(v => v.file === "server/book.test.mjs");
    expect(hit.trace[0].file).toBe("server/main.mjs");
  });
  it("does not blanket-exclude operational scripts", () => {
    const f = fixture(); f.write("server/scripts/maintenance.mjs", 'import "@changmen/mixed/book";');
    expect(f.inspect().violations.some(v => v.file === "server/scripts/maintenance.mjs")).toBe(true);
  });
  it("does not mistake package tests for Node production consumers", () => {
    const f = fixture(); f.write("packages/mixed/book.test.ts", 'import "./browser/book";');
    expect(f.inspect().entries.find(entry => entry.id === "book").consumers).toEqual(expect.arrayContaining([expect.objectContaining({ file: "packages/mixed/book.test.ts", usage: "test" })]));
  });
  it("blocks browser access to a Node entry via an intermediate shared file", () => {
    const f = fixture(); f.write("client/web/src/main.ts", 'import "../../../packages/mixed/bridge";');
    f.write("packages/mixed/bridge.ts", 'export * from "./loader.mjs";');
    expect(f.inspect().violations).toEqual(expect.arrayContaining([expect.objectContaining({ file: "packages/mixed/bridge.ts", pattern: expect.stringContaining("node-only") })]));
  });
  it("inspects declared Node registry files even when a dynamic loader is their only consumer", () => {
    const f = fixture();
    f.write("packages/mixed/registry/paths.js", 'import "../browser/book.ts";');
    f.manifest.nodeOnlyPaths.push("packages/mixed/registry/paths.js");
    expect(f.inspect().violations.some(v => v.file === "packages/mixed/registry/paths.js" && v.pattern.includes("browser-only"))).toBe(true);
  });
  it("inspects every conditional export target and newly added workspace alias", () => {
    const f = fixture();
    f.pkg.exports["./new-alias"] = { node: "./registry/index.ts", default: "./browser/book.ts" };
    f.write("packages/mixed/package.json", f.pkg); f.write("server/main.mjs", 'import "@changmen/mixed/new-alias";');
    expect(f.inspect().violations.some(v => v.pattern.includes(book))).toBe(true);
  });
  it("resolves wildcard exports to their source", () => {
    const f = fixture(); f.pkg.exports["./alias/*"] = "./browser/*.ts";
    f.write("packages/mixed/package.json", f.pkg); f.write("server/main.mjs", 'import "@changmen/mixed/alias/book";');
    expect(f.inspect().violations.some(v => v.pattern.includes(book))).toBe(true);
  });
  it("resolves a dotted Worker basename and keeps its type and runtime URL edges", () => {
    const f = fixture(); f.write("packages/mixed/browser/marketData.worker.ts", "export type Message = string;");
    f.write(book, 'import type {} from "./marketData.worker"; new URL("./marketData.worker.ts", import.meta.url);');
    f.manifest.scopes = { pm: { nodeRoots: ["server"], browserRoots: [book] } };
    const report = inspectComponentEntries(f.root, f.manifest, { scope: "pm" });
    expect(report.dependencies.filter(site => site.file === book).map(site => site.targets)).toEqual([
      ["packages/mixed/browser/marketData.worker.ts"], ["packages/mixed/browser/marketData.worker.ts"],
    ]);
    expect(report.unknown.some(site => site.file === book)).toBe(false);
  });
  it("scope traversal excludes unrelated historical scripts without suppressing shared runtime dependencies", () => {
    const f = fixture(); f.write("server/archive/old.mjs", 'import "./missing.js";');
    f.write("packages/mixed/shared.mjs", 'void import(process.env.INPUT);');
    f.write("server/main.mjs", 'import "../packages/mixed/shared.mjs";');
    f.manifest.scopes = { pm: { nodeRoots: ["server/main.mjs"], browserRoots: [book] } };
    const report = inspectComponentEntries(f.root, f.manifest, { scope: "pm" });
    expect(report.sourceFiles).not.toContain("server/archive/old.mjs");
    expect(report.unknown.some(site => site.file === "packages/mixed/shared.mjs")).toBe(true);
    expect(inspectComponentEntries(f.root, f.manifest).unknown.some(site => site.file === "server/archive/old.mjs")).toBe(true);
    f.write("server/main.mjs", 'import "./archive/old.mjs";');
    expect(inspectComponentEntries(f.root, f.manifest, { scope: "pm" }).unknown.some(site => site.file === "server/archive/old.mjs")).toBe(true);
    expect(() => inspectComponentEntries(f.root, f.manifest, { scope: "unknown" })).toThrow("Unknown component scope");
  });
  it("rejects a remapped public entry rather than trusting stale metadata", () => {
    const f = fixture(); f.pkg.exports["./book"] = "./registry/index.ts"; f.write("packages/mixed/package.json", f.pkg);
    expect(f.inspect().violations.some(v => v.pattern.includes("public export must still resolve exactly"))).toBe(true);
  });
  for (const [name, source] of [
    ["computed import", 'void import(process.env.MODULE);'],
    ["computed require", 'require(`./${name}.mjs`);'],
    ["custom loader", 'adapterRequire("polymarket", "orderBook.ts");'],
    ["custom loader alias", 'import { adapterRequire as load } from "@changmen/mixed/loader"; load("polymarket");'],
    ["Vite glob", 'import.meta.glob("../packages/mixed/browser/*.ts");'],
    ["missing local import", 'import "./missing.mjs";'],
    ["missing workspace import", 'import "@changmen/missing/book";'],
    ["unconfigured alias", 'import "@private-alias/book";'],
    ["package imports alias", 'import "#book";'],
    ["existing malformed script", 'import "@changmen/mixed"; const broken = "unterminated\n;'],
  ]) it(`records ${name} as incomplete evidence, never a frontend-only certificate`, () => {
    const f = fixture(); f.write("server/main.mjs", source);
    const report = f.inspect();
    expect(report.unknown.some(item => item.file === "server/main.mjs" && item.line > 0)).toBe(true);
    expect(report.safeToNarrowPublishScope).toBe(false);
    expect(report.publishScopeOptimizationEnabled).toBe(false);
  });
  it("keeps browser edges recovered from malformed source visible", () => {
    const f = fixture(); f.write("server/main.mjs", 'import "@changmen/mixed/book"; const broken = "unterminated\n;');
    expect(f.inspect().violations.some(v => v.pattern.includes(book))).toBe(true);
  });
  it("does not execute inspected application modules", () => {
    const f = fixture(); f.write("packages/mixed/browser/book.ts", 'throw new Error("must never execute");');
    expect(f.inspect().violations).toEqual([]);
  });
  it("reads Vue script imports and ignores template text and comments", () => {
    expect(componentImportSites("App.vue", '<template>require("fake")</template>\n<script setup lang="ts">\n// import "fake"\nimport "@changmen/mixed/book";\n</script>')).toEqual([
      expect.objectContaining({ line: 4, spec: "@changmen/mixed/book", kind: "static" }),
    ]);
  });
  for (const change of [
    f => { f.manifest.publishScopeOptimizationEnabled = true; },
    f => { f.manifest.entries.push({ ...f.manifest.entries[0] }); },
    f => { f.manifest.entries[0].environment = "node"; },
    f => { f.manifest.entries[0].file = "../outside.ts"; },
    f => { f.manifest.entries[0].file = "packages/mixed/missing.ts"; },
    f => { f.manifest.nodeRoots.push("missing-root"); },
    f => { f.manifest.browserRoots.push("server"); },
    f => { f.manifest.dynamicLoaders[0].status = "safe"; },
  ]) it("fails closed on invalid or contradictory inventory metadata", () => {
    const f = fixture(); change(f);
    try { expect(f.inspect().violations.length).toBeGreaterThan(0); }
    catch (error) { if (error.name === "AssertionError") throw error; expect(error.message).toMatch(/Component inventory|Invalid|Missing|Dynamic loader/); }
  });
  it("audits the current repository with 27 active reviewed entries and no static environment crossing", () => {
    const root = fileURLToPath(new URL("../../", import.meta.url));
    const report = inspectComponentEntries(root);
    expect(report.entries).toHaveLength(27);
    expect(report.entries.some(entry=>entry.id==="venue-node-loader-compat")).toBe(false);
    expect(report.violations).toEqual([]);
    expect(report.safeToNarrowPublishScope).toBe(false);
    expect(report.entries.find(entry => entry.id === "pm-classic-fok").environment).toBe("browser");
    expect(report.entries.find(entry => entry.id === "pm-browser-package")).toMatchObject({ environment: "browser", file: "client/packages/pm-market-data-browser/src/index.ts" });
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "scripts/deploy/component-inputs.json"), "utf8"));
    expect(manifest.isolatedBrowserRoots).toEqual([{ path: "client/packages/pm-market-data-browser/src", typeImports: ["@polymarket/client/actions"] }]);
  }, 30_000);
  it("the real check:boundaries CLI rejects a browser registry import injected into backend memory", () => {
    const root = fileURLToPath(new URL("../../", import.meta.url));
    const code = `import fs from "node:fs";
      const read=fs.readFileSync;
      fs.readFileSync=function(file,...args) {
        const value=read.call(this,file,...args);
        return typeof value === "string" && String(file).replaceAll("\\\\", "/").endsWith("/server/backend/server.js")
          ? value + '\\nimport "@changmen/venue-browser/adapter/registry/adapters";\\n' : value;
      };
      await import("./scripts/check-team-boundaries.mjs");`;
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", code], { cwd: root, encoding: "utf8", timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("[component-entry] server/backend/server.js:");
    expect(result.stderr).toContain("browser-only client/packages/venue-browser/adapter/registry/adapters.ts");
  }, 35_000);
});

for (const [name, source] of [
  ["browser host", 'import "../../../client/web/src/main";'],
  ["shared adapter", 'export * from "../registry/index";'],
  ["external runtime", 'import "node:fs";'],
  ["unknown acquisition", 'void import(globalThis.target);'],
]) it(`rejects isolated browser core escaping to ${name}`, () => {
  const f = fixture();
  f.manifest.isolatedBrowserRoots = [{ path: "packages/mixed/browser", typeImports: [] }];
  f.write(book, source);
  expect(f.inspect().violations.some(row => row.pattern.includes("isolated browser core"))).toBe(true);
});
it("allows isolated internal modules and an explicitly declared type-only SDK", () => {
  const f = fixture();
  f.pkg.devDependencies = { sdk: "1.0.0" };
  f.write("packages/mixed/package.json", f.pkg);
  f.manifest.isolatedBrowserRoots = [{ path: "packages/mixed/browser", typeImports: ["sdk"] }];
  f.write("packages/mixed/browser/protocol.ts", "export interface Event { at: number }");
  f.write(book, 'import type { Event } from "./protocol"; import type { Wire } from "sdk"; export type Value = Event & Wire;');
  expect(f.inspect().violations).toEqual([]);
  f.write(book, 'import { Wire } from "sdk";');
  expect(f.inspect().violations.some(row => row.pattern.includes("isolated browser core"))).toBe(true);
});

it("rejects root-level RDS reaching backend implementation through a re-export", () => {
  const f = fixture();
  f.manifest.nodeRoots.push("rds");
  f.manifest.sourceOwnership = "ownership.json";
  f.write("ownership.json", { schemaVersion: 1, purpose: "source-ownership-only", publishScopeOptimizationEnabled: false,
    roots: ["server", "rds", "packages", "client"], rules: [
      { prefix: "rds", layer: "rds" }, { prefix: "server", layer: "backend" },
      { prefix: "packages", layer: "shared" }, { prefix: "client", layer: "frontend" },
    ] });
  f.write("server/main.mjs", 'export const main = 1;');
  f.write("rds/bridge.mjs", 'export * from "../server/business.mjs";');
  f.write("server/business.mjs", 'export const business = 1;');
  expect(f.inspect().violations.some(row => row.rule === "source-ownership" && row.file === "rds/bridge.mjs")).toBe(true);
});
it("checks explicitly scoped frontend tools without making historical tools new seeds", () => {
  const f = fixture();
  f.manifest.sourceOwnership = "ownership.json";
  f.write("ownership.json", { schemaVersion: 1, purpose: "source-ownership-only", publishScopeOptimizationEnabled: false,
    roots: ["server", "packages", "client", "devtools/venue-adapter"], toolingRoots: ["devtools/venue-adapter"], rules: [
      { prefix: "devtools/venue-adapter", layer: "frontend", role: "tooling" },
      { prefix: "server", layer: "backend" }, { prefix: "packages", layer: "shared" }, { prefix: "client", layer: "frontend" },
    ] });
  f.write("devtools/venue-adapter/check.mjs", 'import "node:fs"; import "../../server/main.mjs";');
  f.write("devtools/history/untouched.mjs", 'import "missing-unreviewed-package";');
  const report = f.inspect();
  expect(report.violations.some(row => row.rule === "source-ownership" && row.file === "devtools/venue-adapter/check.mjs")).toBe(true);
  expect(report.unknown.some(row => row.file === "devtools/history/untouched.mjs")).toBe(false);
});
