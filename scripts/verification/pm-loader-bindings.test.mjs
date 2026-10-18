// [changmen 扩展] In-memory provenance fixtures; no fixture executes or rewrites an application.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, it } from "vitest";
import { analyzePmLoaderBindings } from "./pm-loader-bindings.mjs";
import { inspectPmDependencies } from "./pm-dependency-audit.mjs";

const loader = "export function backendRequire(spec) {}\nexport function reqS(...segments) {}\nexport function adapterRequire(...segments) {}";
const origin = { file: "loader.ts", symbol: "backendRequire" };
function fixture(code, extra = {}, { expected = [{ file: "entry.ts", origin, arguments: ["ws"], count: 1 }], origins = [origin], facade } = {}) {
  const files = { "loader.ts": loader, ...extra, "entry.ts": code }, dependencies = [];
  // Explicit source resolution for this closed fixture; do not import these files.
  for (const [file, text] of Object.entries(files)) {
    const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    function visit(node) {
      const argument = ts.isImportDeclaration(node) || ts.isExportDeclaration(node) ? node.moduleSpecifier
        : ts.isCallExpression(node) ? node.arguments[0] : ts.isExternalModuleReference(node) ? node.expression : undefined;
      if (argument && ts.isStringLiteralLike(argument)) {
        const raw = argument.text, base = path.posix.normalize(path.posix.join(path.posix.dirname(file), raw));
        const targets = [base, `${base}.ts`, `${base}.js`, `${base}.mjs`, `${base}.cjs`, `${base}.vue`].filter(file => Object.hasOwn(files, file));
        dependencies.push({ file, spec: raw, targets });
      }
      ts.forEachChild(node, visit);
    }
    visit(tree);
  }
  return analyzePmLoaderBindings({ files, dependencies, origins, expectedCalls: expected, facade });
}
const good = [
  ["named alias", 'import {backendRequire as run} from "./loader"; run("ws");'],
  ["immutable alias chain", 'import {backendRequire} from "./loader"; const a=backendRequire; const b=a; b("ws");'],
  ["lexical shadow", 'import {backendRequire} from "./loader"; function f(backendRequire){backendRequire(dynamic);} backendRequire("ws");'],
  ["namespace member", 'import * as api from "./loader"; api.backendRequire("ws");'],
  ["namespace alias", 'import * as api from "./loader"; const other=api; const run=other.backendRequire; run("ws");'],
  ["namespace literal element", 'import * as api from "./loader"; api["backendRequire"]("ws");'],
  ["destructured namespace", 'import * as api from "./loader"; const {backendRequire:run}=api; run("ws");'],
  ["named re-export", 'import {run} from "./barrel";run("ws");', { "barrel.ts": 'export {backendRequire as run} from "./loader";' }],
  ["local alias re-export", 'import {run} from "./barrel";run("ws");', { "barrel.ts": 'import {backendRequire} from "./loader";const alias=backendRequire;export {alias as run};' }],
  ["exported alias", 'import {run} from "./barrel";run("ws");', { "barrel.ts": 'import {backendRequire} from "./loader";export const run=backendRequire;' }],
  ["star re-export chain", 'import {backendRequire} from "./outer";backendRequire("ws");', { "barrel.ts": 'export * from "./loader";', "outer.ts": 'export * from "./barrel";' }],
  ["cyclic barrel", 'import {backendRequire} from "./a";backendRequire("ws");', { "a.ts": 'export * from "./b";', "b.ts": 'export * from "./a";export * from "./loader";' }],
  ["namespace re-export", 'import * as outer from "./barrel";outer.api.backendRequire("ws");', { "barrel.ts": 'export * as api from "./loader";' }],
  ["default re-export", 'import run from "./barrel";run("ws");', { "barrel.ts": 'export {backendRequire as default} from "./loader";' }],
  ["default expression", 'import run from "./barrel";run("ws");', { "barrel.ts": 'import {backendRequire} from "./loader";export default backendRequire;' }],
  ["awaited namespace", 'const api=await import("./loader");api.backendRequire("ws");'],
  ["awaited destructuring", 'const {backendRequire:run}=await import("./loader");run("ws");'],
  ["CJS require namespace", 'const api=require("./loader");api.backendRequire("ws");'],
  ["CJS module.require", 'const api=module.require("./loader");api.backendRequire("ws");'],
  ["CJS require alias", 'const req=require;const {backendRequire:run}=req("./loader");run("ws");'],
  ["Node createRequire", 'import {createRequire as make} from "node:module";const req=make(import.meta.url);const api=req("./loader");api.backendRequire("ws");'],
  ["Node factory namespace", 'import * as mod from "node:module";const make=mod.createRequire;const req=make(import.meta.url);req("./loader").backendRequire("ws");'],
  ["TS import equals", 'import api=require("./loader");api.backendRequire("ws");'],
  ["CJS barrel object", 'const api=require("./barrel.cjs");api.run("ws");', { "barrel.cjs": 'const {backendRequire}=require("./loader");module.exports={run:backendRequire};' }],
  ["CJS barrel namespace", 'const api=require("./barrel.cjs");api.backendRequire("ws");', { "barrel.cjs": 'module.exports=require("./loader");' }],
  ["CJS named export", 'const api=require("./barrel.cjs");api.run("ws");', { "barrel.cjs": 'const {backendRequire}=require("./loader");exports.run=backendRequire;' }],
  ["CJS function export", 'const run=require("./barrel.cjs");run("ws");', { "barrel.cjs": 'const {backendRequire}=require("./loader");module.exports=backendRequire;' }],
  ["CJS default namespace", 'import api from "./barrel.cjs";api.run("ws");', { "barrel.cjs": 'const {backendRequire}=require("./loader");module.exports={run:backendRequire};' }],
  ["transparent assertion", 'import * as api from "./loader";const run=(api.backendRequire as any)!;run("ws");'],
  ["nested namespace destructuring", 'import * as outer from "./barrel";const {api:{backendRequire:run}}=outer;run("ws");', { "barrel.ts": 'export * as api from "./loader";' }],
];
for (const [name, code, extra] of good) it(`binds ${name} to its real definition`, () => {
  const result = fixture(code, extra);
  expect(result.violations).toEqual([]);
  expect(result.calls).toHaveLength(1);
  expect(result.calls[0].origin).toEqual(origin);
  expect(result.safeToNarrowPublishScope).toBe(false);
});
const bad = [
  ["computed argument", 'import {backendRequire as run} from "./loader";run(input);'],
  ["spread arguments", 'import {backendRequire as run} from "./loader";run(...args);'],
  ["namespace computed key", 'import * as api from "./loader";api[key]("ws");'],
  ["missing namespace member", 'import * as api from "./loader";api.missing("ws");'],
  ["Reflect namespace lookup", 'import * as api from "./loader";Reflect.get(api,key)("ws");'],
  ["callback escape", 'import {backendRequire as run} from "./loader";consume(run);'],
  ["object escape", 'import {backendRequire as run} from "./loader";const bag={run};'],
  ["array escape", 'import {backendRequire as run} from "./loader";const bag=[run];'],
  ["return escape", 'import * as api from "./loader";function f(){return api.backendRequire;}'],
  ["namespace escape", 'import * as api from "./loader";consume(api);'],
  ["namespace spread", 'import * as api from "./loader";const copy={...api};'],
  ["namespace rest", 'import * as api from "./loader";const {...copy}=api;'],
  ["destructuring default", 'import * as api from "./loader";const {backendRequire:run=fallback}=api;run("ws");'],
  ["mutable alias", 'import {backendRequire} from "./loader";let run=backendRequire;run("ws");'],
  ["alias reassignment", 'import {backendRequire} from "./loader";const run=backendRequire;run=other;run("ws");'],
  ["namespace mutation", 'import * as api from "./loader";api.backendRequire=other;'],
  ["namespace unrelated mutation", 'import * as api from "./loader";api.metadata=other;'],
  ["namespace deletion", 'import * as api from "./loader";delete api.backendRequire;'],
  ["conditional source", 'import {backendRequire} from "./loader";const run=flag?backendRequire:other;run("ws");'],
  ["call indirection", 'import {backendRequire as run} from "./loader";run.call(null,"ws");'],
  ["apply indirection", 'import {backendRequire as run} from "./loader";run.apply(null,["ws"]);'],
  ["bind indirection", 'import {backendRequire as run} from "./loader";run.bind(null)("ws");'],
  ["unawaited import callback", 'import("./loader").then(api=>api.backendRequire("ws"));'],
  ["unawaited import escape", 'const pending=import("./loader");consume(pending);'],
  ["computed import", 'const api=await import(input);api.backendRequire("ws");'],
  ["computed require", 'const req=require;const api=req(input);api.backendRequire("ws");'],
  ["duplicate call", 'import {backendRequire} from "./loader";backendRequire("ws");backendRequire("ws");'],
  ["redirected argument", 'import {backendRequire} from "./loader";backendRequire("different");'],
  ["missing call", 'import {backendRequire} from "./loader";'],
  ["type-only runtime use", 'import type {backendRequire} from "./loader";backendRequire("ws");'],
  ["CJS callback escape", 'const {backendRequire:run}=require("./barrel.cjs");consume(run);', { "barrel.cjs": 'module.exports=require("./loader");' }],
  ["CJS computed export", 'const api=require("./barrel.cjs");api[key]("ws");', { "barrel.cjs": 'const {backendRequire}=require("./loader");module.exports={[key]:backendRequire};' }],
  ["require transformation", 'const req=require.bind(null);const api=req("./loader");api.backendRequire("ws");'],
];
for (const [name, code, extra] of bad) it(`fails closed for ${name}`, () => {
  const result = fixture(code, extra);
  expect(result.violations.length).toBeGreaterThan(0);
  expect(result.safeToNarrowPublishScope).toBe(false);
});
it("does not confuse a same-named unrelated definition with an imported loader", () => {
  const result = fixture('import {backendRequire} from "./other";backendRequire(input);', { "other.ts": 'export function backendRequire(value){return value;}' }, { expected: [] });
  expect(result.calls).toEqual([]); expect(result.violations).toEqual([]);
});
it("does not confuse a shadowed CJS module object with the CommonJS export binding", () => {
  const result = fixture('import {backendRequire as run} from "./loader";const module={};module.exports={run};', {}, { expected: [] });
  expect(result.violations.some(row => row.rule === "pm-loader-unknown")).toBe(true);
});
it("keeps the same-named probes origin separate from the central origin", () => {
  const other = { file: "other.ts", symbol: "backendRequire" };
  const result = fixture('import {backendRequire as run} from "./other";run("ws");', { "other.ts": loader }, { origins: [origin, other] });
  expect(result.calls[0].origin).toEqual(other);
  expect(result.violations.some(row => row.rule === "pm-loader-call")).toBe(true);
});
it("allows ordinary namespace metadata and unrelated destructuring defaults", () => {
  const result = fixture('import * as meta from "./meta";const {value=fallback}=meta;use(value);', { "meta.ts": "export const value=1;" }, { expected: [] });
  expect(result.violations).toEqual([]);
});
it("allows loader type references without treating them as runtime invocations", () => {
  const result = fixture('import type {backendRequire} from "./loader";type Signature=typeof backendRequire;', {}, { expected: [] });
  expect(result.calls).toEqual([]); expect(result.violations).toEqual([]);
});
it("checks facade provenance independently of spelling and call count", () => {
  const facade = { file: "facade.ts", exports: { run: "loader.ts#backendRequire" } };
  const okay = fixture('import {run} from "./facade";run("ws");', { "facade.ts": 'export {backendRequire as run} from "./loader";' }, { facade });
  expect(okay.violations).toEqual([]);
  const bad = fixture('import {run} from "./facade";run("ws");', { "facade.ts": 'export {backendRequire as run} from "./other";', "other.ts": loader }, { facade });
  expect(bad.violations.some(row => row.rule === "pm-loader-origin")).toBe(true);
});
it("fails closed for ambiguous conditional-export resolution rather than choosing the loader-bearing branch", () => {
  const result = analyzePmLoaderBindings({
    files: { "loader.ts": loader, "other.ts": "export function backendRequire(value){return value;}", "entry.ts": 'import {backendRequire} from "./conditional";backendRequire("ws");' },
    dependencies: [{ file: "entry.ts", spec: "./conditional", targets: ["loader.ts", "other.ts"] }],
    origins: [origin], expectedCalls: [{ file: "entry.ts", origin, arguments: ["ws"], count: 1 }],
  });
  expect(result.violations.some(row => row.rule === "pm-loader-unknown")).toBe(true);
});
it("rejects invalid origins, syntax and duplicate call registrations", () => {
  expect(fixture("function (", {}, { expected: [] }).violations.some(row => row.rule === "pm-loader-syntax")).toBe(true);
  expect(fixture("", {}, { origins: [{ file: "missing.ts", symbol: "backendRequire" }], expected: [] }).violations.some(row => row.rule === "pm-loader-origin")).toBe(true);
  expect(() => fixture("", {}, { origins: [origin, origin], expected: [] })).toThrow("Duplicate loader origin");
  const expected = [{ file: "entry.ts", origin, arguments: ["ws"], count: 1 }];
  expect(() => fixture("", {}, { expected: [...expected, ...expected] })).toThrow("Invalid source-bound");
});
it("covers the real PM graph, runtime preload dependencies and nine reviewed source-bound calls", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url)), report = inspectPmDependencies(root);
  expect(report.violations).toEqual([]);
  expect(report.unknownSummary.inherited).toBe(20);
  expect(report.loaderBindings.origins).toHaveLength(8);
  expect(report.loaderBindings.calls).toHaveLength(9);
  expect(report.loaderBindings.scannedSourceFiles).toBe(932);
  // [changmen 扩展] 保留旧端口配置覆盖，并明确覆盖迁出的完整共享端口解析实现。
  for (const file of ["server/storage/dev_web_config.js", "packages/shared/tooling/dev_web_port.js"])
    expect(report.loaderBindings.inputEvidence.some(row => row.file === file)).toBe(true);
  expect(report.loaderBindings.inputEvidence.some(row => row.file.includes("/scripts/"))).toBe(false);
  expect(report.loaderBindings.runtimeRoots).toHaveLength(21);
  expect(report.loaderBindings.originalUnknowns).toBe(20);
  expect(report.loaderBindings.rawUnknowns).toBe(31);
  expect(report.loaderBindings.runtimeRootsCertified).toBe(false);
  expect(report.loaderBindings.safeToNarrowPublishScope).toBe(false);
}, 25_000);
it("fails closed for configured external roots without executing or reading those roots", () => {
  const name = "CHANGMEN_ADAPTER_ROOT", previous = process.env[name];
  try {
    process.env[name] = "Z:/pm-loader-gate-never-read-external-root";
    const report = inspectPmDependencies(fileURLToPath(new URL("../../", import.meta.url)));
    expect(report.loaderBindings.violations.some(row => row.rule === "pm-loader-unknown" && row.file === "<runtime-inputs>")).toBe(true);
    expect(report.loaderBindings.runtimeRootsCertified).toBe(false);
    expect(JSON.stringify(report.loaderBindings)).not.toContain(process.env[name]);
  } finally {
    if (previous === undefined) delete process.env[name]; else process.env[name] = previous;
  }
}, 25_000);
