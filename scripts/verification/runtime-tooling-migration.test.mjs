import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import { createHash } from "node:crypto";
import {historicalCreateRequire as createRequire} from './workspace-layout-history.mjs';
import { it, expect } from "vitest";
import { gitSource } from "./fok-exact-boundaries.mjs";
import { restoreRuntimeToolingMetadata } from "./runtime-tooling-migration.mjs";
import { restoreDependencySecurityMetadata } from "./dependency-security-metadata.mjs";
import { restoreRuntimeCoverageSource } from "./runtime-source-coverage.mjs";
import { restorePmSourceIsolationMetadata, PM_METADATA_BASELINE } from "./pm-source-isolation-metadata.mjs";
import { classifyDeployScope } from "../deploy/classify-deploy-scope.mjs";
import { restoreRetirementPolicy } from "./publish-retirement-metadata.mjs";
const record = JSON.parse(fs.readFileSync(new URL("./runtime-tooling-migration.json", import.meta.url), "utf8"));
const read = file => restoreDependencySecurityMetadata(file, restoreRetirementPolicy(file, fs.readFileSync(file, "utf8")));
const sha = source => createHash("sha256").update(source).digest("hex");
for (const row of record.changes) it(`${row.file}: restores the entire previous committed input without accepting extra content`, () => {
  const current = read(row.file), previous = restoreRuntimeToolingMetadata(row.file, current);
  expect(sha(current)).toBe(row.migratedSha256);
  expect(previous).toBe(gitSource(record.baselineCommit, row.file));
  expect(restoreRuntimeToolingMetadata(row.file, current + "\n")).not.toBe(previous);
});
it("keeps historical metadata and immutable protection files byte-equivalent to the existing commit", () => {
  for (const file of ["pm-source-isolation-metadata.json", "pm-frontend-install-metadata.json", "pm-frontend-build-metadata.json",
    "pm-node-consumer-metadata.json", "pm-backend-tool-metadata.json", "pm-client-folder-metadata.json",
    "runtime-source-coverage.json", "frontend-build-inputs.json", "vps-fok-baseline.json", "retained-source-boundaries.json"])
    expect(read(`scripts/verification/${file}`)).toBe(gitSource(record.baselineCommit, `scripts/verification/${file}`));
  for (const file of ["packages/shared/package.json", "package-lock.json"])
    expect(restorePmSourceIsolationMetadata(file, read(file), gitSource(PM_METADATA_BASELINE, file))).toBe(gitSource(PM_METADATA_BASELINE, file));
});
it("has a single canonical implementation and unchanged declarations/port algorithm", () => {
  expect(record.moves).toHaveLength(4);
  const frozen = JSON.parse(read("scripts/verification/vps-fok-baseline.json")).protectedFiles;
  for (const row of record.moves) {
    expect(frozen[row.from]).toBeUndefined(); expect(sha(read(row.to))).toBe(row.migratedSha256);
    if (!row.to.endsWith("runtime_version.js")) expect(read(row.to)).toBe(gitSource(record.baselineCommit, row.from));
    expect(read(row.from)).toContain('export * from "@changmen/runtime-tooling/');
  }
  expect(restoreRuntimeCoverageSource(read("devtools/runtime-tooling/runtime_version.js")))
    .toBe(gitSource("abdfce46d46f562c208ea0d832b6cafc02fd2360", "server/storage/runtime_version.js"));
  expect(fs.realpathSync(createRequire(import.meta.url).resolve("@changmen/runtime-tooling/runtime_version.js")))
    .toBe(fs.realpathSync("devtools/runtime-tooling/runtime_version.js"));
});
for (const [label, mutate] of [
  ["new Git coverage removed", source => source.replace('  if (file.startsWith("devtools/runtime-tooling/")) return true;\n', "")],
  ["new archive discovery removed", source => source.replace('"devtools/runtime-tooling", ', "")],
  ["tool prefix broadened", source => source.replace('startsWith("devtools/runtime-tooling/")', 'startsWith("devtools/")')],
]) it(`rejects ${label} before the complete original algorithm comparison`, () => {
  const source = read("devtools/runtime-tooling/runtime_version.js"), changed = mutate(source);
  expect(changed).not.toBe(source); expect(() => restoreRuntimeCoverageSource(changed)).toThrow();
});
it("does not narrow publication because the runtime helper moved", () => {
  for (const file of ["devtools/runtime-tooling/runtime_version.js", "devtools/runtime-tooling/dev_web_port.js"])
    expect(classifyDeployScope([file])).toBe("full");
});
