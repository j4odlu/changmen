// [changmen 扩展] Only exact read-only PM-M hooks; original fixed baselines are retained.
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
const normalize = source => source.replaceAll("\r\n", "\n");
const digest = source => createHash("sha256").update(normalize(source)).digest("hex");
const text = normalize(fs.readFileSync(new URL("./pm-shared-stream-increments.json", import.meta.url), "utf8"));
assert.equal(digest(text), "7be9cabc5ec274cefbf96608df52893384d70eb46b0d51799cfce9c99d3bd2ef", "reviewed passive stream hooks stay fixed");
const { changes } = JSON.parse(text);
export function restorePmSharedStreamSource(file, source, required = false) {
  const row = changes[file];
  if (!row) return source;
  let restored = normalize(source);
  if (!required && !row.increments.some(([, after]) => restored.includes(after))) return restored;
  for (const [before, after] of row.increments) {
    assert.equal(restored.split(after).length, 2, file + ": exact passive stream hook");
    restored = restored.replace(after, before);
  }
  assert.equal(digest(restored), row.beforeSha, file + ": complete pre-hook source unchanged");
  return restored;
}
export function verifyPmSharedStreamContract(read) {
  for (const file of Object.keys(changes)) restorePmSharedStreamSource(file, read(file), true);
}
