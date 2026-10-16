// [changmen 扩展] 经典 FOK 恢复自动准备 signer；其余模式及原冻结基线逐字保留。
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { restorePmFokCancellationSource, verifyPmFokCancellationContract } from "./pm-fok-cancellation-boundary.mjs";
const normalize = value => value.replaceAll("\r\n", "\n");
const digest = value => createHash("sha256").update(normalize(value)).digest("hex");
const text = normalize(fs.readFileSync(new URL("./pm-legacy-fok-runtime-increments.json", import.meta.url), "utf8"));
assert.equal(digest(text), "b9950ebd093af8bb71ccd81e78b7204a91e3526c0e77af5d2a4cc27466f6ad3d", "legacy FOK runtime recovery increments stay fixed");
const { changes } = JSON.parse(text);
export function restorePmLegacyFokRuntimeSource(file, source, required = false) {
  source = restorePmFokCancellationSource(file, source);
  const row = changes[file];
  if (!row) return source;
  let result = normalize(source);
  if (!required && !row.increments.some(([, after]) => result.includes(after))) return result;
  for (const [before, after] of row.increments) {
    assert.equal(result.split(after).length, 2, file + ": exact legacy FOK runtime recovery");
    result = result.replace(after, before);
  }
  return result;
}
export function verifyPmLegacyFokRuntimeContract(read) {
  verifyPmFokCancellationContract(read);
  for (const [file, row] of Object.entries(changes))
    assert(row.beforeShas.includes(digest(restorePmLegacyFokRuntimeSource(file, read(file), true))),
      file + ": unchanged outside legacy FOK runtime recovery");
}
