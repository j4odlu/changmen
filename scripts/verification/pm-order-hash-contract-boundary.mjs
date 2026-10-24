// [changmen 扩展] Only the recovery hash contract-config source changes; preserve all historical baselines.
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";

const normalize = source => source.replaceAll("\r\n", "\n");
export const pmOrderHashContractSha = source => createHash("sha256").update(normalize(source)).digest("hex");
const text = fs.readFileSync(new URL("./pm-order-hash-contract-increments.json", import.meta.url), "utf8");
assert.equal(pmOrderHashContractSha(text), "7aeb59dbcb6c026d1d295f4a2dc8772c55230f142b496144e9e1f8b82e9c5225", "PM order hash contract increments changed");
export const PM_ORDER_HASH_CONTRACTS = JSON.parse(text);
const files = new Map(PM_ORDER_HASH_CONTRACTS.files.map(row => [row.file, row]));
export const pmOrderHashContractFiles = new Set(files.keys());

export function restorePmOrderHashContractSource(file, source) {
  const row = files.get(file);
  if (!row || pmOrderHashContractSha(source) !== row.afterSha) return source;
  source = normalize(source);
  for (const edit of [...row.changes].reverse()) {
    assert.equal(source.slice(edit.offset, edit.offset + edit.after.length), edit.after, file + ": exact contract-config increment");
    source = source.slice(0, edit.offset) + edit.before + source.slice(edit.offset + edit.after.length);
  }
  assert.equal(pmOrderHashContractSha(source), row.beforeSha, file + ": complete previous source must restore");
  return source;
}

export function verifyPmOrderHashContractSources(read = file => fs.readFileSync(new URL("../../" + file, import.meta.url), "utf8")) {
  for (const row of files.values()) {
    const source = read(row.file);
    assert.equal(pmOrderHashContractSha(source), row.afterSha, row.file + ": only the exact contract-config migration is authorized");
    assert.equal(pmOrderHashContractSha(restorePmOrderHashContractSource(row.file, source)), row.beforeSha);
  }
  return { files: files.size };
}
