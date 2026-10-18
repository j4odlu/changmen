// [changmen 扩展] Reverse only the exact Node tooling migration before previous complete-source proofs.
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { restoreDependencySecurityMetadata } from "./dependency-security-metadata.mjs";
const record = JSON.parse(fs.readFileSync(new URL("./runtime-tooling-migration.json", import.meta.url), "utf8"));
const sha = source => createHash("sha256").update(source).digest("hex");
assert.equal(record.schemaVersion, 1);
assert.equal(record.purpose, "node-tooling-folder-isolation-only");
assert.equal(record.baselineCommit, "02b5092c7b8b51d0cc6022af50fd8e73226116d6");
assert.equal(record.historicalBaseline, "a233e20534395b31401828e754432407b109053d");
assert.equal(record.publishScopeOptimizationEnabled, false);
assert.deepEqual(record.changes.map(row => row.file), ["package.json", "package-lock.json", "client/web/package.json",
  "server/storage/package.json", "scripts/verification/source-ownership-inputs.json", "scripts/deploy/component-inputs.json"]);
assert.equal(record.runtime.file, "devtools/runtime-tooling/runtime_version.js");
assert.equal(record.runtime.baselineSha256, "8a2d9633f34099e4d2f7f5bdf518566291f05989fd70e686f3e0f2c41c1df1ae");
assert.equal(record.runtime.patches.length, 2);
function restore(source, change) {
  assert.equal(sha(source), change.migratedSha256, "Only the exact registered Node tooling migration is accepted");
  const lines = source.split("\n");
  for (const patch of [...change.patches].reverse()) {
    assert.equal(patch.before.length, patch.oldCount); assert.equal(patch.after.length, patch.newCount);
    const start = patch.newCount === 0 ? patch.newStart : patch.newStart - 1;
    assert(Number.isInteger(start) && start >= 0 && start <= lines.length);
    assert.deepEqual(lines.slice(start, start + patch.newCount), patch.after);
    lines.splice(start, patch.newCount, ...patch.before);
  }
  const previous = lines.join("\n");
  assert.equal(sha(previous), change.baselineSha256, "Complete previous tooling input must restore exactly");
  return previous;
}
export function restoreRuntimeToolingMetadata(file, source) {
  source = restoreDependencySecurityMetadata(file, source);
  const change = record.changes.find(row => row.file === file);
  return change && sha(source) === change.migratedSha256 ? restore(source, change) : source;
}
export function restoreRuntimeToolingCoverage(source) {
  source = source.replaceAll("\r\n", "\n");
  return sha(source) === record.runtime.migratedSha256 ? restore(source, record.runtime) : source;
}
