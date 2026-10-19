// [changmen 扩展] Preserve complete historical proofs around catalog tooling changes.
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { restoreVenueBrowserMetadata } from "./venue-browser-relocation.mjs";
import { restoreBackendToolMetadata } from "./backend-tool-relocation.mjs";
const normalize = source => source.replaceAll("\r\n", "\n");
const sha = source => createHash("sha256").update(normalize(source)).digest("hex");
const text = fs.readFileSync(new URL("./venue-manifest-metadata.json", import.meta.url), "utf8");
assert.equal(sha(text), "f907e411e76437bd8b30e678f08f83e916d78e32e20aa34c78a434960bfdeb04");
export const VENUE_MANIFEST_METADATA = JSON.parse(text);
export function restoreVenueManifestMetadata(file, source) {
  source = restoreBackendToolMetadata(file, source);
  source = restoreVenueBrowserMetadata(file, source);
  source = normalize(source);
  const row = VENUE_MANIFEST_METADATA.changes.find(row => row.file === file);
  if (!row || sha(source) !== row.afterSha) return source;
  const lines = source.split("\n");
  for (const patch of [...row.patches].reverse()) {
    assert.equal(patch.before.length, patch.oldCount);
    assert.equal(patch.after.length, patch.newCount);
    const start = patch.newCount === 0 ? patch.newStart : patch.newStart - 1;
    assert.deepEqual(lines.slice(start, start + patch.newCount), patch.after);
    lines.splice(start, patch.newCount, ...patch.before);
  }
  const restored = lines.join("\n");
  assert.equal(sha(restored), row.beforeSha, `${file}: complete previous metadata`);
  return restored;
}
