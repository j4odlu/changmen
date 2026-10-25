// Current ownership, dependency direction and compatibility contracts; no historical SDK/source audit.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import { classifySourceFile, sourceLayerViolation, sourceOwnershipInventory, validateSourceOwnership } from "./source-ownership.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const policy = validateSourceOwnership(JSON.parse(fs.readFileSync(path.join(root, "scripts/verification/source-ownership-inputs.json"), "utf8")));
it("separates frontend, backend, RDS and shared implementations while preserving frozen Node paths", () => {
  for (const [file, layer] of [
    ["packages/venue-adapter/browser/pm-book-diagnostics/bookRuntime.ts", "frontend"],
    ["server/venues/loader/adapter_paths.mjs", "backend"],
    ["server/venues/registry/paths.js", "backend"],
    ["packages/venue-adapter/registry/adapters.ts", "frontend"],
    ["rds/maintenance/rds-schema-check.mjs", "rds"],
    ["server/match/resolver/index.js", "backend"],
    ["packages/shared/match-identity/teams/team_key.js", "shared"],
  ]) expect(classifySourceFile(file, policy)?.layer).toBe(layer);
});
for (const [file, target] of [
  ["packages/venue-adapter/browser/main.ts", "rds/index.js"],
  ["server/backend/main.js", "packages/venue-adapter/browser/pm-book-diagnostics/bookRuntime.ts"],
  ["rds/main.js", "server/match/resolver/index.js"],
  ["rds/main.js", "server/backend/core/business.js"],
  ["packages/shared/rule.ts", "rds/index.js"],
  ["packages/shared/rule.ts", "packages/client-core/src/bridge/clientApi.ts"],
  ["server/backend/main.js", "packages/unreviewed/main.js"],
]) it(`rejects ${file} reaching ${target}`, () => expect(sourceLayerViolation(file, target, policy)).toBeTruthy());
it("allows reviewed public data operations, shared rules and Node storage infrastructure", () => {
  for (const [file, target] of [
    ["server/backend/main.js", "rds/profile_metadata.js"],
    ["rds/main.js", "server/storage/load_env.js"],
    ["rds/rds/team_store.js", "packages/shared/match-identity/index.js"],
    ["client/web/src/main.ts", "packages/shared/odds_format.ts"],
  ]) expect(sourceLayerViolation(file, target, policy)).toBeNull();
});
it("classifies every inventoried source and keeps compatibility JSON identical", () => {
  const report = sourceOwnershipInventory(root);
  expect(report.unclassified).toEqual([]); expect(report.incompatibleAssets).toEqual([]);
  expect(report.incompatibleEntries).toEqual([]);
  expect(report.publishScopeOptimizationEnabled).toBe(false);
});
it("has no retired identity or shared-tooling implementation aliases", () => {
  expect(policy.compatibilityEntries).toEqual([]);
  for(const file of ["server/match/identity/index.js","packages/shared/tooling/package.json"])
    expect(fs.existsSync(path.join(root,file))).toBe(false);
  expect(classifySourceFile("packages/shared/match-identity/index.js",policy).layer).toBe("shared");
});
it("never permits ownership metadata to grant a release exemption", () => {
  expect(() => validateSourceOwnership({ ...policy, publishScopeOptimizationEnabled: true })).toThrow("Invalid");
  expect(() => validateSourceOwnership({ ...policy, rules: [{ prefix: "../escape", layer: "shared" }] })).toThrow("Invalid");
});
it("rejects extra work in a migrated CLI wrapper", () => {
  const target = policy.compatibilityCliEntries[0].file, read = fs.readFileSync;
  const spy = vi.spyOn(fs, "readFileSync").mockImplementation((file, ...args) => {
    const text = read.call(fs, file, ...args);
    return typeof text === "string" && String(file).replaceAll("\\", "/").endsWith(target) ? text + "\nvoid unexpectedQuery();\n" : text;
  });
  try { expect(sourceOwnershipInventory(root).incompatibleEntries.some(row => row.file === target)).toBe(true); }
  finally { spy.mockRestore(); }
});
it("classifies frontend maintenance, backend packaging and shared validation separately", () => {
  for (const [file, layer] of [
    ["client/devtools/venue-adapter/sync-package-exports.mjs", "frontend"],
    ["packages/venue-adapter/scripts/list-web-venue-imports.mjs", "frontend"],
    ["server/venues/sync-backend-bundle.mjs", "backend"],
    ["devtools/venue-adapter/verification/check-esport-freeze.mjs", "shared"],
    ["rds/maintenance/check-rds-schema.mjs", "rds"],
  ]) expect(classifySourceFile(file, policy)?.layer).toBe(layer);
});
