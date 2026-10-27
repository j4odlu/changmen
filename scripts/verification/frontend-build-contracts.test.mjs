// Current serving contracts and build-boundary faults; implementation equivalence is an explicit historical audit.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
import { inspectFrontendBuildContracts } from "./frontend-build-contracts.mjs";
import { inspectComponentEntries } from "./component-entry-boundary.mjs";
const root = fileURLToPath(new URL("../../", import.meta.url));
const read = file => fs.readFileSync(path.join(root, file));
it("binds serving asset hashes to exact Git archive and checkout bytes", () => {
  const contract = JSON.parse(read("client/web/vite/legacyPublicAssets.json"));
  for (const [id, asset] of Object.entries(contract.assets)) {
    const file = `server/backend/public/assets/${id.slice(contract.prefix.length)}`;
    const committed = execFileSync("git", ["show", `HEAD:${file}`], { cwd: root });
    expect(read(file)).toEqual(committed);
    expect(createHash("sha256").update(committed).digest("hex")).toBe(asset.sha256);
  }
});
it("uses exactly the same native Node exports at old and shared entry points", () => {
  const code = `import assert from 'node:assert/strict';
    const old=await import('@changmen/storage/runtime_version.js'),shared=await import('@changmen/runtime-tooling/runtime_version.js'),canonical=await import('@changmen/runtime-tooling/runtime_version.js');assert.deepEqual(Object.keys(old),Object.keys(shared));for(const key of Object.keys(shared)){assert.equal(old[key],shared[key]);assert.equal(old[key],canonical[key]);}
    const oldPort=await import('@changmen/storage/dev_web_config.js'),sharedPort=await import('@changmen/runtime-tooling/dev_web_port.js');assert.equal(oldPort.resolveDevWebPort,sharedPort.resolveDevWebPort);
    console.log('same native exports');`;
  expect(execFileSync(process.execPath, ["--input-type=module", "--eval", code], { cwd: root, encoding: "utf8", windowsHide: true })).toContain("same native exports");
});
for (const mode of ["missing", "changed"])
  it(`rejects a ${mode} serving asset while frontend builds use only the contract`, () => {
    const file = "server/backend/public/assets/CQ1lLIdm.woff2";
    const result = inspectFrontendBuildContracts(root, { readFile: f => {
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
    expect(inspectFrontendBuildContracts(root, { readFile: f => f === file ? Buffer.from(JSON.stringify(contract)) : read(f) }).violations.length).toBeGreaterThan(0);
  });
it("rejects deregistering the active build inputs or allowing Node tools into browser runtime", () => {
  for (const file of ["scripts/verification/source-ownership-inputs.json", "scripts/deploy/component-inputs.json"]) {
    const contract = JSON.parse(read(file));
    if (contract.toolingRoots) contract.toolingRoots = contract.toolingRoots.filter(f => !f.startsWith("client/web/"));
    else contract.nodeOnlyPaths = contract.nodeOnlyPaths.filter(f => f !== "devtools/runtime-tooling");
    expect(inspectFrontendBuildContracts(root, { readFile: f => f === file ? Buffer.from(JSON.stringify(contract)) : read(f) }).violations.length).toBeGreaterThan(0);
  }
});
for (const [file, statement, rule] of [
  ["client/web/src/main.ts", 'import "@changmen/shared/tooling/runtime_version.js";', "component-entry"],
  ["client/web/src/main.ts", 'import "@changmen/runtime-tooling/runtime_version.js";', "component-entry"],
  ["client/web/vite/plugins/runtimeVersion.ts", 'import "../../../../rds/index.js";', "source-ownership"],
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
  write("rds/index.js", "export const data = 1;");
  write("client/web/src/main.ts", "export const main = 1;");
  write("client/web/vite/plugins/runtimeVersion.ts", "export const plugin = 1;");
  write(file, statement);
  write("ownership.json", { schemaVersion: 1, purpose: "source-ownership-only", publishScopeOptimizationEnabled: false,
    roots: ["client", "packages", "server", "rds"], toolingRoots: ["client/web/vite"], rules: [
      { prefix: "client", layer: "frontend", role: "tooling" }, { prefix: "packages", layer: "shared" },
      { prefix: "rds", layer: "rds" }, { prefix: "server", layer: "backend" },
    ] });
  const manifest = { schemaVersion: 1, purpose: "inventory-and-boundary-only", publishScopeOptimizationEnabled: false,
    nodeRoots: ["rds"], nodeOnlyPaths: ["packages/shared/tooling", "devtools/runtime-tooling"], browserRoots: ["client/web/src"], browserOnlyPaths: [],
    conservativeInputs: ["package.json"], entries: [], testEntries: [], dynamicLoaders: [], sourceOwnership: "ownership.json" };
  try { expect(inspectComponentEntries(fixture, manifest).violations.some(row => row.rule === rule && row.file === file)).toBe(true); }
  finally {
    if (path.dirname(fixture) !== path.resolve(os.tmpdir()) || !path.basename(fixture).startsWith("changmen-build-graph-")) throw Error("Invalid fixture cleanup target");
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

it("accepts implementation evolution while retaining the current serving and ownership contracts", () => {
 for(const file of ["devtools/runtime-tooling/runtime_version.js", "devtools/runtime-tooling/dev_web_port.js", "server/storage/dev_web_config.ts"])
  expect(inspectFrontendBuildContracts(root,{readFile:f=>f===file?Buffer.concat([read(f),Buffer.from("\nvoid 0;\n")]):read(f)}).violations).toEqual([]);
});
