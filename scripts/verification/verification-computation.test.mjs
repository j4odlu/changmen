import { expect, it } from "vitest";
import fs from "node:fs";
import { moduleTokens, replaceExact } from "./fok-exact-boundaries.mjs";
import { analyzePmLoaderBindings } from "./pm-loader-bindings.mjs";
import { sourceFixture } from "./fixtures/source-fixture.mjs";
import { readHistoricalValidationSource, restoreValidationAuditSource } from "./validation-audit-boundary.mjs";
import { inspectPmDependencies } from "./pm-dependency-audit.mjs";
import { withAdapterHistoryReader, readAdapterHistory } from "./browser-entry-history.mjs";
import { VENUE_BROWSER_RELOCATION, verifyVenueBrowserRelocation } from "./venue-browser-relocation.mjs";
import { changePlan } from "../deploy/change-plan.mjs";

it("repeated token comparisons cannot reuse a caller's corrupted result", () => {
  const source = 'const payload = "a b"; send(payload);';
  const expected = structuredClone(moduleTokens(source)), poisoned = moduleTokens(source);
  poisoned[0][0] = -1; poisoned[0][1] = "different"; poisoned.length = 0;
  expect(moduleTokens(source)).toEqual(expected);
  expect(moduleTokens(source.replace('"a b"', '"a  b"'))).not.toEqual(expected);
  for (let i = 0; i < 2; i++) expect(() => moduleTokens("export const broken = ;")).toThrow("must parse");
});

it("cached exact replacements retain each input's offsets and uniqueness checks", () => {
  expect(replaceExact('send("a b"); next();', 'send("a b");', "done();")).toBe("done(); next();");
  expect(replaceExact('\n\n send("a b"); next();', 'send("a b");', "done();")).toBe("\n\n done(); next();");
  expect(() => replaceExact('send("a b"); send("a b");', 'send("a b");')).toThrow("exact boundary occurrence");
  expect(() => replaceExact('send("a  b");', 'send("a b");')).toThrow("exact boundary occurrence");
});

it("loader values are refreshed as a reverse-ordered export chain converges", () => {
  const origin = { file: "loader.ts", symbol: "load" };
  const files = { "main.ts": 'import {load} from "./barrel0"; const alias=load; alias("ws");' };
  const dependencies = [{ file: "main.ts", spec: "./barrel0", targets: ["barrel0.ts"] }];
  for (let i = 0; i < 8; i++) {
    const next = i === 7 ? "loader" : `barrel${i + 1}`;
    files[`barrel${i}.ts`] = `export {load} from "./${next}";`;
    dependencies.push({ file: `barrel${i}.ts`, spec: `./${next}`, targets: [`${next}.ts`] });
  }
  files["loader.ts"] = "export function load(name) {}";
  const inspect = () => analyzePmLoaderBindings({ files, dependencies, origins: [origin],
    expectedCalls: [{ file: "main.ts", origin, arguments: ["ws"], count: 1 }] });
  expect(inspect().violations).toEqual([]);
  files["main.ts"] = files["main.ts"].replace('alias("ws")', "alias(unknown)");
  expect(inspect().violations.some(row => row.rule === "pm-loader-unknown")).toBe(true);
});

it("source fixtures cache the baseline while every fault overlay remains visible", () => {
  let source = 'send("original");';
  const read = sourceFixture(() => source);
  const expected = moduleTokens(read("fixture.ts"));
  expect(() => moduleTokens(read("fixture.ts") + "\nconst broken = ;")).toThrow();
  expect(moduleTokens(read("fixture.ts"))).toEqual(expected);
  const missing = file => { if (file === "fixture.ts") throw Error("missing"); return read(file); };
  expect(() => missing("fixture.ts")).toThrow("missing");
  source = 'send("changed");';
  expect(moduleTokens(sourceFixture(() => source)("fixture.ts"))).not.toEqual(expected);
});

it("loader candidate names retain Unicode, escaped identifiers, default declarations and lexical shadows", () => {
  const origin = { file: "loader.ts", symbol: "load" };
  for (const alias of ["__load", "$load", "加载", "\\u006coad"]) {
    const files = {
      "loader.ts": 'export default function load(name) {} load("origin");',
      "main.ts": `import ${alias} from "./loader"; ${alias}("ws"); function f(${alias}) { ${alias}(unknown); }`,
    };
    const report = analyzePmLoaderBindings({ files,
      dependencies: [{ file: "main.ts", spec: "./loader", targets: ["loader.ts"] }], origins: [origin],
      expectedCalls: [{ file: "main.ts", origin, arguments: ["ws"], count: 1 },
        { file: "loader.ts", origin, arguments: ["origin"], count: 1 }] });
    expect(report.violations, alias).toEqual([]);
    expect(report.calls, alias).toHaveLength(2);
  }
});

it("historical control fixtures retain fault overlays and inspections cannot cross source roots", () => {
  const file = "scripts/check-team-boundaries.mjs", current = fs.readFileSync(file, "utf8");
  const historical = readHistoricalValidationSource(file);
  expect(restoreValidationAuditSource(file, current)).toBe(historical);
  for (const source of [current, historical]) {
    const changed = source + "\nvoid injected();\n";
    expect(restoreValidationAuditSource(file, changed)).toBe(changed);
  }
  expect(() => inspectPmDependencies(process.cwd(), { inspection: { root: "another workspace" } })).toThrow("another source root");
});

it("a complete relocation proof reads each input once and a later proof rejects changed or missing inputs", () => {
  const baseline = sourceFixture(withAdapterHistoryReader(file => readAdapterHistory(file, "utf8")));
  const reads = new Map();
  expect(verifyVenueBrowserRelocation(file => {
    reads.set(file, (reads.get(file) || 0) + 1); return baseline(file);
  }).entries).toBe(10);
  expect(reads.size).toBeGreaterThan(0);
  expect(Math.max(...reads.values())).toBe(1);
  const changed = VENUE_BROWSER_RELOCATION.rows[0].canonical;
  expect(() => verifyVenueBrowserRelocation(file => baseline(file) + (file === changed ? "\nvoid injected();\n" : ""))).toThrow();
  expect(() => verifyVenueBrowserRelocation(file => {
    if (file === changed) throw Error("missing"); return baseline(file);
  })).toThrow("missing");
});

it("optimizing the real boundary command runs its verifier regressions without publishing applications", () => {
  const paths = ["scripts/check-team-boundaries.mjs", "scripts/verification/pm-loader-bindings.mjs"];
  for (const selection of [[paths[0]], paths]) {
    const plan = changePlan(selection, { purpose: "release" });
    expect(plan.tier).toBe("controls");
    expect(plan.deployment.scope).toBe("noop");
    expect(plan.checks).toEqual(["verification-control", "verification-node"]);
  }
  expect(changePlan([...paths, "client/web/src/App.vue"]).deployment.scope).toBe("frontend");
  expect(changePlan([...paths, "server/backend/server.js"]).deployment.scope).toBe("backend");
  expect(changePlan(["scripts/check-team-boundaries.mjs.runtime.js"]).deployment.scope).toBe("full");
});
