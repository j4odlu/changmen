import {adapterCanonicalFile} from "./browser-entry-history.mjs";
// [changmen 扩展] In-memory tampering only; never edits protected application sources.
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import { inspectRetainedSourceBoundaries } from "./retained-source-boundaries.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
function changed(target, transform, run) {
  const read = fs.readFileSync;
  const spy = vi.spyOn(fs, "readFileSync").mockImplementation((file, ...args) => {
    const value = read.call(fs, file, ...args);
    return typeof value === "string" && String(file).replaceAll("\\", "/").endsWith(target) ? transform(value) : value;
  });
  try { run(); } finally { spy.mockRestore(); }
}
it("keeps six finite retained groups with named exit conditions and no release authority", () => {
  const report = inspectRetainedSourceBoundaries(root);
  expect(report.violations).toEqual([]); expect(report.groups).toHaveLength(6);
  expect(report.compatibilityEntries).toBe(152); expect(report.compatibilityCliEntries).toBe(6);
  expect(report.installationCertified).toBe(false); expect(report.publishScopeOptimizationEnabled).toBe(false);
});
for (const file of ["packages/venue-adapter/loader/adapter_paths.mjs", "packages/venue-adapter/registry/adapters.ts",
  "server/db/assets/migrations/001_baseline.sql", "server/db/assets/schema-baseline.json",
  "packages/venue-adapter/scripts/sync-backend-bundle.mjs", "server/storage/paths.js"]) {
  it(`rejects retained contract changes to ${file}`, () => changed(adapterCanonicalFile(file),
    value => file.endsWith(".json") ? JSON.stringify({ ...JSON.parse(value), unreviewed: true }) : value + "\nvoid changedSource();\n",
    () => expect(()=>{const report=inspectRetainedSourceBoundaries(root);if(report.violations.length)throw Error("retained source violation");}).toThrow()));
}
it("rejects silently dropping an old compatibility import", () => changed("scripts/verification/source-ownership-inputs.json", value => {
  const policy = JSON.parse(value); policy.compatibilityEntries.pop(); return JSON.stringify(policy);
}, () => expect(inspectRetainedSourceBoundaries(root).violations.some(row => row.file.includes("source-ownership"))).toBe(true)));
it("rejects dropping a frozen file from the retained inventory", () => changed("scripts/verification/retained-source-boundaries.json", value => {
  const policy = JSON.parse(value); policy.groups.find(group => group.id === "frozen-adapter-island").files.pop(); return JSON.stringify(policy);
}, () => expect(inspectRetainedSourceBoundaries(root).violations.length).toBeGreaterThan(0)));
it("rejects broadening the old direct database access locations", () => changed("scripts/verification/backend-db-access-exceptions.json", value => {
  const policy = JSON.parse(value); policy.sites.push({ ...policy.sites[0], file: "server/backend/new-business.js" }); return JSON.stringify(policy);
}, () => expect(inspectRetainedSourceBoundaries(root).violations.length).toBeGreaterThan(0)));
for (const [name, edit] of [
  ["publication authority", policy => policy.publishScopeOptimizationEnabled = true],
  ["missing group", policy => policy.groups.pop()],
  ["missing exit condition", policy => delete policy.groups[0].exitCondition],
  ["path escape", policy => policy.groups[0].files[0] = "../outside.js"],
]) it(`rejects ${name}`, () => changed("scripts/verification/retained-source-boundaries.json", value => {
  const policy = JSON.parse(value); edit(policy); return JSON.stringify(policy);
}, () => expect(() => inspectRetainedSourceBoundaries(root)).toThrow()));
