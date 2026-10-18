// [changmen 扩展] Reverse only exact workspace type declarations and development
// dependencies. All earlier full-file proofs and SDK records remain mandatory.
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
const sha = source => createHash("sha256").update(source).digest("hex");
const text = fs.readFileSync(new URL("./pm-sports-typescript-metadata.json", import.meta.url), "utf8").replaceAll("\r\n", "\n");
assert.equal(sha(text), "d491b193f794db1c28b43a791fe4c6320ac35f025ca0bdfeafc4d1ea08c5a925");
const record = JSON.parse(text);
assert.equal(record.schemaVersion, 1);
assert.equal(record.purpose, "pm-sports-typescript-declarations-only");
assert.deepEqual(record.changes.map(row => row.file), ["package-lock.json", "server/db/package.json", "server/storage/package.json", "server/collectors/polymarket-sports/package.json"]);
export function restorePmSportsTypeScriptMetadata(file, source) {
  const row = record.changes.find(row => row.file === file);
  if (!row) return source;
  source = source.replaceAll("\r\n", "\n");
  if (sha(source) !== row.afterSha256) return source;
  assert.equal(source.slice(row.start, row.start + row.after.length), row.after);
  const restored = source.slice(0, row.start) + row.before + source.slice(row.start + row.after.length);
  assert.equal(sha(restored), row.beforeSha256, "The complete previous metadata must restore exactly");
  return restored;
}
