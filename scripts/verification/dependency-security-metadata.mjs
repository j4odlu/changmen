// [changmen 扩展] Reverse only the reviewed security patch; all older full-source proofs remain unchanged.
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { restorePmCollectorTypeScriptMetadata } from "./pm-collector-typescript-metadata.mjs";
const record = JSON.parse(fs.readFileSync(new URL("./dependency-security-metadata.json", import.meta.url), "utf8"));
const previous = JSON.parse(fs.readFileSync(new URL("./runtime-tooling-migration.json", import.meta.url), "utf8"));
const sha = source => createHash("sha256").update(source).digest("hex");
assert.equal(record.schemaVersion, 1);
assert.equal(record.purpose, "reviewed-dependency-security-patches-only");
assert.equal(record.baselineCommit, "8db3321d04aca0924998b93fc9fd3efd89ebd8d6");
assert.equal(record.historicalBaseline, "a233e20534395b31401828e754432407b109053d");
assert.equal(record.immutableFokBaseline, "75b1efac66625e5f2bc9884a965b244bfaf337ed");
assert.deepEqual(record.changes.map(row => row.file), ["package.json", "package-lock.json"]);
for (const row of record.changes)
  assert.equal(row.baselineSha256, previous.changes.find(old => old.file === row.file).migratedSha256);

export function restoreDependencySecurityMetadata(file, source) {
  source = restorePmCollectorTypeScriptMetadata(file, source);
  source = source.replaceAll("\r\n", "\n");
  const row = record.changes.find(change => change.file === file);
  if (!row || sha(source) !== row.migratedSha256) return source;
  const lines = source.split("\n");
  for (const patch of [...row.patches].reverse()) {
    assert.equal(patch.before.length, patch.oldCount); assert.equal(patch.after.length, patch.newCount);
    const start = patch.newCount === 0 ? patch.newStart : patch.newStart - 1;
    assert(Number.isInteger(start) && start >= 0 && start <= lines.length);
    assert.deepEqual(lines.slice(start, start + patch.newCount), patch.after);
    lines.splice(start, patch.newCount, ...patch.before);
  }
  const restored = lines.join("\n");
  assert.equal(sha(restored), row.baselineSha256, "Security patches must restore the entire previous input exactly");
  return restored;
}
