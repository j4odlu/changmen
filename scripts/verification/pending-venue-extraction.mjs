// [changmen 扩展] Exact lifecycle extraction proof. Offline historical readers only;
// original FOK, migration and pending-fix inventories remain immutable.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
const normalize = source => source.replaceAll("\r\n", "\n");
const sha = source => createHash("sha256").update(normalize(source)).digest("hex");
const nativeRead = file => fs.readFileSync(new URL("../../" + file, import.meta.url), "utf8");
const text = fs.readFileSync(new URL("./pending-venue-extraction.json", import.meta.url), "utf8");
assert.equal(sha(text), "8451275ab177af3c1885c509132f02fa7659e1a305b48931a8f1c562ac8f7cee", "Pending extraction inventory changed");
export const PENDING_VENUE_EXTRACTION = JSON.parse(text);
const record = PENDING_VENUE_EXTRACTION;
assert.equal(record.purpose, "pending-venue-lifecycle-extraction-only");
assert.equal(sha(record.before), record.beforeSha, "Original pending gateway snapshot changed");
for (const row of record.verification)
  assert.equal(sha(row.before), row.beforeSha, "Original pending verification snapshot changed");
function verifyAssets(read) {
  for (const row of record.assets)
    assert.equal(sha(read(row.file)), row.sha, row.file + ": extracted pending implementation changed");
}
export function restorePendingVenueExtractionSource(file, source, read = nativeRead) {
  if (file !== record.file || sha(source) !== record.afterSha) return source;
  verifyAssets(read);
  return record.before;
}
export function restorePendingVenueVerificationSource(file, source) {
  const row = record.verification.find(row => row.file === file);
  if (!row || sha(source) !== row.afterSha) return source;
  verifyAssets(nativeRead);
  return row.before;
}
export function verifyPendingVenueExtraction(read) {
  assert.equal(sha(read(record.file)), record.afterSha, "Unreviewed pending lifecycle extraction");
  verifyAssets(read);
  for (const row of record.verification)
    assert.equal(sha(read(row.file)), row.afterSha, "Unreviewed pending verification change");
  return { files: 1, assets: record.assets.length };
}
