// [changmen 扩展] Offline exact-source inverse for the OB football extraction.
// Original FOK and migration manifests are unchanged; no runtime source patching.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
const sha = source => createHash("sha256").update(source.replaceAll("\r\n", "\n")).digest("hex");
const nativeRead = file => fs.readFileSync(new URL("../../" + file, import.meta.url), "utf8");
const text = fs.readFileSync(new URL("./ob-football-extraction.json", import.meta.url), "utf8");
assert.equal(sha(text), "d78adfed4126e2b9b10b365f91d676b5dd2dcf06baa398a8c1a8cd3d49ff8db6", "OB football extraction inventory changed");
export const OB_FOOTBALL_EXTRACTION = JSON.parse(text);
const record = OB_FOOTBALL_EXTRACTION;
assert.equal(record.purpose, "ob-football-response-dto-extraction-only");
assert.equal(sha(record.before), record.beforeSha, "Original OB football source changed");
function verifyAssets(read) {
  for (const row of record.assets)
    assert.equal(sha(read(row.file)), row.sha, row.file + ": extracted OB football implementation changed");
}
export function restoreObFootballSource(file, source, read = nativeRead) {
  if (file !== record.file || sha(source) !== record.afterSha) return source;
  verifyAssets(read);
  return record.before;
}
export function verifyObFootballExtraction(read) {
  assert.equal(sha(read(record.file)), record.afterSha, "Unreviewed OB football extraction");
  verifyAssets(read);
  return { files: 1, assets: record.assets.length };
}
