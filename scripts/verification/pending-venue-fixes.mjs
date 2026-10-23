// [changmen 扩展] Exact fixes for pending order write races, publication and session lifecycle.
// Original FOK and migration inventories remain immutable; this is an offline source reader only.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
const normalize = source => source.replaceAll("\r\n", "\n");
const sha = source => createHash("sha256").update(normalize(source)).digest("hex");
const text = fs.readFileSync(new URL("./pending-venue-fixes.json", import.meta.url), "utf8");
assert.equal(sha(text), "4830b5e3b4d46a417dc51ad3bf16def6f933b8a161a607b3f72d6d835320625d", "Pending venue fix inventory changed");
export const PENDING_VENUE_FIXES = JSON.parse(text);
assert.equal(PENDING_VENUE_FIXES.purpose, "pending-venue-confirmation-bug-fixes");
const rows = new Map(PENDING_VENUE_FIXES.files.map(row => {
  assert.equal(sha(row.before), row.beforeSha, row.file + ": original snapshot changed");
  return [row.file, row];
}));
export const pendingVenueFixFiles = new Set(rows.keys());
export function restorePendingVenueFixSource(file, source) {
  const row = rows.get(file);
  if (!row || sha(source) !== row.afterSha) return source;
  for (const asset of PENDING_VENUE_FIXES.assets)
    assert.equal(sha(fs.readFileSync(new URL("../../" + asset.file, import.meta.url), "utf8")), asset.sha,
      asset.file + ": pending venue fix implementation changed");
  return row.before;
}
export function verifyPendingVenueFixes(read) {
  for (const row of rows.values()) assert.equal(sha(read(row.file)), row.afterSha, row.file + ": unreviewed pending venue fix");
  for (const row of PENDING_VENUE_FIXES.assets) assert.equal(sha(read(row.file)), row.sha, row.file + ": pending venue fix implementation changed");
  return { files: rows.size, assets: PENDING_VENUE_FIXES.assets.length };
}
