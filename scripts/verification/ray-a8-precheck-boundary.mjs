// [changmen 扩展] 用户授权恢复 RAY A8 预检的精确增量；其余迁移/FOK 基线继续逐字核对。
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { restore9999CProbabilityVerificationSource } from "./single-leg-9999-c-probability-boundary.mjs";
import { restoreRayExecutionRepairSource, verifyRayExecutionRepairSources } from "./ray-a8-execution-repair-boundary.mjs";

const normalize = source => source.replaceAll("\r\n", "\n");
const sha = source => createHash("sha256").update(normalize(source)).digest("hex");
const text = fs.readFileSync(new URL("./ray-a8-precheck-increments.json", import.meta.url), "utf8");
assert.equal(sha(text), "a81b02b8c2c0d217fee257d8547f692dee4a06ceb4c2aabc0132ae46bf5c8353", "RAY A8 precheck increments changed");
const inventory = JSON.parse(text);
const entries = new Map(inventory.files.map(row => [row.file, row]));

export function restoreRayA8PrecheckSource(file, source) {
  source = restoreRayExecutionRepairSource(file, source);
  source = restore9999CProbabilityVerificationSource(file, source);
  const row = entries.get(file);
  if (!row) return source;
  source = normalize(source);
  // 历史证明可能再次传入更早的已恢复版本；未知内容不改写，仍由原哈希闸门检查。
  if (sha(source) !== row.afterSha) return source;
  for (const edit of [...row.changes].reverse()) {
    assert.equal(source.slice(edit.offset, edit.offset + edit.after.length), edit.after, `${file}: exact RAY precheck increment`);
    source = source.slice(0, edit.offset) + edit.before + source.slice(edit.offset + edit.after.length);
  }
  assert.equal(sha(source), row.beforeSha, `${file}: original source baseline must restore`);
  return source;
}

export function verifyRayA8PrecheckSources(read) {
  verifyRayExecutionRepairSources(read);
  for (const row of entries.values())
    assert.equal(sha(restore9999CProbabilityVerificationSource(row.file, restoreRayExecutionRepairSource(row.file, read(row.file)))), row.afterSha, `${row.file}: only the exact RAY A8 precheck change is authorized`);
  return { files: entries.size };
}
