// [changmen 扩展] Four ownership layers are independent of file location and release selection.
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
    ["server/packages/venue-node-loader/adapter_paths.mjs", "backend"],
    ["server/packages/venue-node-registry/paths.js", "backend"],
    ["packages/venue-adapter/registry/adapters.ts", "frontend"],
    ["server/db/maintenance/rds-schema-check.mjs", "rds"],
    ["server/match/resolver/index.js", "backend"],
    ["packages/shared/match-identity/teams/team_key.js", "shared"],
  ]) expect(classifySourceFile(file, policy)?.layer).toBe(layer);
});
for (const [file, target] of [
  ["packages/venue-adapter/browser/main.ts", "server/db/index.js"],
  ["server/backend/main.js", "packages/venue-adapter/browser/pm-book-diagnostics/bookRuntime.ts"],
  ["server/db/main.js", "server/match/resolver/index.js"],
  ["server/db/main.js", "server/backend/core/business.js"],
  ["packages/shared/rule.ts", "server/db/index.js"],
  ["packages/shared/rule.ts", "packages/client-core/src/bridge/clientApi.ts"],
  ["server/backend/main.js", "packages/unreviewed/main.js"],
]) it(`rejects ${file} reaching ${target}`, () => expect(sourceLayerViolation(file, target, policy)).toBeTruthy());
it("allows reviewed public data operations, shared rules and Node storage infrastructure", () => {
  for (const [file, target] of [
    ["server/backend/main.js", "server/db/profile_metadata.js"],
    ["server/db/main.js", "server/storage/load_env.js"],
    ["server/db/rds/team_store.js", "packages/shared/match-identity/index.js"],
    ["client/web/src/main.ts", "packages/shared/odds_format.ts"],
  ]) expect(sourceLayerViolation(file, target, policy)).toBeNull();
});
it("classifies every inventoried source and keeps compatibility JSON identical", () => {
  const report = sourceOwnershipInventory(root);
  expect(report.unclassified).toEqual([]); expect(report.incompatibleAssets).toEqual([]);
  expect(report.incompatibleEntries).toEqual([]);
  expect(report.files.filter(row => row.protected551)).toHaveLength(551);
  expect(report.publishScopeOptimizationEnabled).toBe(false);
});
it("rejects an implementation being added back into a migrated compatibility entry", () => {
  const target = policy.compatibilityEntries[0].file;
  const read = fs.readFileSync;
  const spy = vi.spyOn(fs, "readFileSync").mockImplementation((file, ...args) => {
    const text = read.call(fs, file, ...args);
    return typeof text === "string" && String(file).replaceAll("\\", "/").endsWith(target) ? text + "\nexport const duplicatedImplementation = 1;\n" : text;
  });
  try { expect(sourceOwnershipInventory(root).incompatibleEntries.some(row => row.file === target)).toBe(true); }
  finally { spy.mockRestore(); }
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
    ["server/packages/venue-adapter-tools/sync-backend-bundle.mjs", "backend"],
    ["devtools/venue-adapter/verification/check-esport-freeze.mjs", "shared"],
    ["server/db/maintenance/check-rds-schema.mjs", "rds"],
  ]) expect(classifySourceFile(file, policy)?.layer).toBe(layer);
});
