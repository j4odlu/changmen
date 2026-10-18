import { it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertBackendResolutionParity, captureBackendResolution } from "./backend-install-resolution.mjs";
it("rejects removed importers, changed SDK identity, missing targets and hidden uncertainty", () => {
  const baseline = { entries: [{ name: "service" }], files: ["server/start.js"],
    resolutions: [{ file: "server/start.js", spec: "sdk", target: "node_modules/sdk/index.js", sha256: "original", version: "1" }],
    unknown: [{ file: "server/start.js", expression: "variable" }], unresolved: [] };
  expect(() => assertBackendResolutionParity(baseline, structuredClone(baseline))).not.toThrow();
  for (const mutate of [r => { r.entries = []; }, r => { r.files = []; }, r => { r.resolutions = []; },
    r => { r.resolutions[0].version = "2"; }, r => { r.resolutions[0].sha256 = "different"; },
    r => { r.resolutions[0].error = "MODULE_NOT_FOUND"; }, r => { r.unknown = []; }]) {
    const candidate = structuredClone(baseline); mutate(candidate);
    expect(() => assertBackendResolutionParity(baseline, candidate)).toThrow();
  }
  expect(() => assertBackendResolutionParity({ resolutions: [] }, { resolutions: [] })).toThrow();
  const missing = { ...baseline, unresolved: [{ spec: "missing" }] };
  expect(() => assertBackendResolutionParity(missing, missing)).toThrow();
});
it("uses require.resolve directory semantics and records directory URLs as resources without executing code", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "changmen-resolution-fixture-"));
  try {
    fs.mkdirSync(path.join(root, "service/dep"), { recursive: true });
    fs.writeFileSync(path.join(root, "service/start.mjs"), "import {createRequire} from 'node:module';const require=createRequire(import.meta.url);require.resolve('./dep');const directory=new URL('./',import.meta.url);throw Error('Must never execute');");
    fs.writeFileSync(path.join(root, "service/dep/index.js"), "throw Error('Must never execute dependency');");
    const report = captureBackendResolution(root, [{ directory: "service", script: "start.mjs" }], { ...process.env, NODE_PATH: "", NODE_OPTIONS: "" });
    expect(report.unresolved).toEqual([]);
    expect(report.resolutions.find(row => row.spec === "./dep").target).toBe("service/dep/index.js");
    expect(report.resolutions.find(row => row.spec === "./")).toMatchObject({ target: "service", assetType: "directory" });
    fs.appendFileSync(path.join(root, "service/start.mjs"), "\nimport './missing.js';");
    const missing = captureBackendResolution(root, [{ directory: "service", script: "start.mjs" }], process.env);
    expect(missing.unresolved).toHaveLength(1);
    expect(() => assertBackendResolutionParity(missing, missing)).toThrow();
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
