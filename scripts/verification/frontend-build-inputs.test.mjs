// [changmen 扩展] Full source equivalence, serving-contract checks and negative build-boundary cases.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
import { gitSource } from "./fok-exact-boundaries.mjs";
import { inspectFrontendBuildInputs } from "./frontend-build-inputs.mjs";
import { inspectComponentEntries } from "./component-entry-boundary.mjs";
import { restoreRuntimeCoverageSource } from "./runtime-source-coverage.mjs";
const root = fileURLToPath(new URL("../../", import.meta.url));
const read = file => fs.readFileSync(path.join(root, file));
it("keeps the complete original identity algorithm, including every original source filter", () => {
  expect(restoreRuntimeCoverageSource(read("devtools/runtime-tooling/runtime_version.js").toString()))
    .toBe(gitSource("abdfce46d46f562c208ea0d832b6cafc02fd2360", "server/storage/runtime_version.js"));
  expect(read("devtools/runtime-tooling/runtime_version.d.ts").toString().replaceAll("\r\n", "\n"))
    .toBe(gitSource("abdfce46d46f562c208ea0d832b6cafc02fd2360", "server/storage/runtime_version.d.ts"));
  expect(inspectFrontendBuildInputs(root).violations).toEqual([]);
});
it("uses exactly the same native Node exports at old and shared entry points", () => {
  const code = `import assert from 'node:assert/strict';
    const old=await import('./server/storage/runtime_version.js'),shared=await import('@changmen/shared/tooling/runtime_version.js'),canonical=await import('@changmen/runtime-tooling/runtime_version.js');assert.deepEqual(Object.keys(old),Object.keys(shared));for(const key of Object.keys(shared)){assert.equal(old[key],shared[key]);assert.equal(old[key],canonical[key]);}
    const oldPort=await import('./server/storage/dev_web_config.js'),sharedPort=await import('@changmen/shared/tooling/dev_web_port.js');assert.equal(oldPort.resolveDevWebPort,sharedPort.resolveDevWebPort);
    console.log('same native exports');`;
  expect(execFileSync(process.execPath, ["--input-type=module", "--eval", code], { cwd: root, encoding: "utf8", windowsHide: true })).toContain("same native exports");
});
for (const file of ["packages/shared/tooling/runtime_version.js", "packages/shared/tooling/dev_web_port.js", "devtools/runtime-tooling/runtime_version.js", "devtools/runtime-tooling/dev_web_port.js", "server/storage/runtime_version.js", "server/storage/dev_web_config.js"])
  it(`rejects any unregistered implementation/wrapper change in ${file}`, () => {
    const result = inspectFrontendBuildInputs(root, { readFile: f => f === file ? Buffer.concat([read(f), Buffer.from("\nvoid 0;\n")]) : read(f) });
    expect(result.violations.some(row => row.file === file)).toBe(true);
  });
for (const mode of ["missing", "changed"])
  it(`rejects a ${mode} serving asset while frontend builds use only the contract`, () => {
    const file = "server/backend/public/assets/CQ1lLIdm.woff2";
    const result = inspectFrontendBuildInputs(root, { readFile: f => {
      if (f !== file) return read(f);
      if (mode === "missing") throw Object.assign(Error("missing"), { code: "ENOENT" });
      return Buffer.concat([read(f), Buffer.from([0])]);
    } });
    expect(result.violations.some(row => row.file === file)).toBe(true);
  });
for (const mode of ["missing entry", "extra entry", "escaping entry"])
  it(`rejects asset contract ${mode}`, () => {
    const file = "client/web/vite/legacyPublicAssets.json", contract = JSON.parse(read(file));
    if (mode === "missing entry") delete contract.assets["/esport2/assets/CQ1lLIdm.woff2"];
    else contract.assets[mode === "extra entry" ? "/esport2/assets/extra.png" : "/esport2/assets/../secret"] = { sha256: "0".repeat(64) };
    expect(inspectFrontendBuildInputs(root, { readFile: f => f === file ? Buffer.from(JSON.stringify(contract)) : read(f) }).violations.length).toBeGreaterThan(0);
  });
it("rejects deregistering the active build inputs or allowing Node tools into browser runtime", () => {
  for (const file of ["scripts/verification/source-ownership-inputs.json", "scripts/deploy/component-inputs.json"]) {
    const contract = JSON.parse(read(file));
    if (contract.toolingRoots) contract.toolingRoots = contract.toolingRoots.filter(f => !f.startsWith("client/web/"));
    else contract.nodeOnlyPaths = contract.nodeOnlyPaths.filter(f => f !== "packages/shared/tooling");
    expect(inspectFrontendBuildInputs(root, { readFile: f => f === file ? Buffer.from(JSON.stringify(contract)) : read(f) }).violations.length).toBeGreaterThan(0);
  }
});
for (const [file, statement, rule] of [
  ["client/web/src/main.ts", 'import "@changmen/shared/tooling/runtime_version.js";', "component-entry"],
  ["client/web/src/main.ts", 'import "@changmen/runtime-tooling/runtime_version.js";', "component-entry"],
  ["client/web/vite/plugins/runtimeVersion.ts", 'import "../../../../server/db/index.js";', "source-ownership"],
]) it(`rejects an invalid dependency added to ${file}`, () => {
  const fixture = fs.mkdtempSync(path.join(path.resolve(os.tmpdir()), "changmen-build-graph-"));
  const write = (name, value) => {
    const target = path.join(fixture, name); fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, typeof value === "string" ? value : JSON.stringify(value));
  };
  write("package.json", { workspaces: ["packages/shared", "devtools/runtime-tooling"] });
  write("devtools/runtime-tooling/package.json", { name: "@changmen/runtime-tooling", exports: { "./runtime_version.js": "./runtime_version.js" } });
  write("devtools/runtime-tooling/runtime_version.js", "export const identity = 1;");
  write("packages/shared/package.json", { name: "@changmen/shared", exports: { "./tooling/runtime_version.js": "./tooling/runtime_version.js" } });
  write("packages/shared/tooling/runtime_version.js", "export const identity = 1;");
  write("server/db/index.js", "export const data = 1;");
  write("client/web/src/main.ts", "export const main = 1;");
  write("client/web/vite/plugins/runtimeVersion.ts", "export const plugin = 1;");
  write(file, statement);
  write("ownership.json", { schemaVersion: 1, purpose: "source-ownership-only", publishScopeOptimizationEnabled: false,
    roots: ["client", "packages", "server"], toolingRoots: ["client/web/vite"], rules: [
      { prefix: "client", layer: "frontend", role: "tooling" }, { prefix: "packages", layer: "shared" },
      { prefix: "server/db", layer: "rds" }, { prefix: "server", layer: "backend" },
    ] });
  const manifest = { schemaVersion: 1, purpose: "inventory-and-boundary-only", publishScopeOptimizationEnabled: false,
    nodeRoots: ["server"], nodeOnlyPaths: ["packages/shared/tooling", "devtools/runtime-tooling"], browserRoots: ["client/web/src"], browserOnlyPaths: [],
    conservativeInputs: ["package.json"], entries: [], testEntries: [], dynamicLoaders: [], sourceOwnership: "ownership.json" };
  try { expect(inspectComponentEntries(fixture, manifest).violations.some(row => row.rule === rule && row.file === file)).toBe(true); }
  finally {
    if (path.dirname(fixture) !== path.resolve(os.tmpdir()) || !path.basename(fixture).startsWith("changmen-build-graph-")) throw Error("Invalid fixture cleanup target");
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
