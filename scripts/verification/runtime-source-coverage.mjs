// [changmen 扩展] Exact additive coverage proof; the original full-source hash remains fixed.
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { restoreRuntimeToolingCoverage } from "./runtime-tooling-migration.mjs";
import {restoreWorkspaceLayoutSource} from './workspace-layout-history.mjs';

const record = JSON.parse(fs.readFileSync(new URL("./runtime-source-coverage.json", import.meta.url), "utf8"));
const sha = text => createHash("sha256").update(text).digest("hex");
assert.equal(record.schemaVersion, 1);
assert.equal(record.purpose, "runtime-source-coverage-only");
assert.equal(record.file, "packages/shared/tooling/runtime_version.js");
assert.equal(record.baselineCommit, "abdfce46d46f562c208ea0d832b6cafc02fd2360");
assert.equal(record.baselineSha256, "23a65e104e76e24aedecca73845238b5a4ca70e2e5584f454a2423d65231f821");
assert.equal(record.changes.length, 2);

export function restoreRuntimeCoverageSource(source) {
  source = restoreWorkspaceLayoutSource('devtools/runtime-tooling/runtime_version.js',source);
  source = restoreRuntimeToolingCoverage(source);
  assert.equal(sha(source), record.migratedSha256, "Only the exact registered runtime coverage change is accepted");
  for (const change of [...record.changes].reverse()) {
    assert.equal(source.split(change.after).length, 2, "Exactly one registered runtime coverage location");
    source = source.replace(change.after, change.before);
  }
  assert.equal(sha(source), record.baselineSha256, "Complete original runtime identity algorithm must restore exactly");
  return source;
}
