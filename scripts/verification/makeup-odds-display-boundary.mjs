// [changmen 扩展] Restore only the reviewed presentation changes before historical checks.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
const normalize = text => text.replaceAll('\r\n', '\n');
const digest = text => createHash('sha256').update(normalize(text)).digest('hex');
const text = fs.readFileSync(new URL('./makeup-odds-display-increments.json', import.meta.url), 'utf8');
assert.equal(digest(text), '6a8f105740eae662111a1667f51232ff3f81873729ac7d40ec85e0d1210628b3', 'exact makeup odds display increments');
const { changes } = JSON.parse(text);

export function restoreMakeupOddsDisplaySource(file, source) {
  const row = changes[file];
  if (!row) return source;
  let restored = normalize(source);
  // Older sources continue through the existing complete-module checks unchanged.
  if (!/\b(?:MakeupOddsBand|makeupDisplayBand)\b/.test(restored)) return restored;
  for (const [before, after] of row.increments) {
    assert.equal(restored.split(after).length, 2, `${file}: exact makeup odds display increment`);
    restored = restored.replace(after, before);
  }
  assert.equal(digest(restored), row.beforeSha, `${file}: complete source outside makeup odds display change`);
  return restored;
}
