import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
// [changmen 扩展] Only frozen simulation inputs; the HTTP call and FOK algorithm are unchanged.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { restoreVenueBrowserContracts } from './venue-browser-contracts.mjs';
const normalize = s => s.replaceAll('\r\n', '\n');
const digest = s => createHash('sha256').update(normalize(s)).digest('hex');
const text = normalize(readAdapterHistory(new URL('./pm-execution-shadow-increments.json', import.meta.url), 'utf8'));
assert.equal(digest(text), '9af82e9ee43c32dbeb9970ac62cd22bb16a26869633eb5c7313b93755d5c4709');
const { changes } = JSON.parse(text);
export function restorePmExecutionShadowSource(file, source, required = false, read) {
  source = restoreVenueBrowserContracts(file, source, read);
  const row = changes[file]; if (!row) return source;
  let restored = normalize(source);
  if (!required && !row.increments.some(([, after]) => restored.includes(after))) return restored;
  for (const [before, after] of row.increments) {
    assert.equal(restored.split(after).length, 2, file + ': exact simulation-only increment');
    restored = restored.replace(after, before);
  }
  return restored;
}
export function verifyPmExecutionShadowContract(read) {
  for (const [file, row] of Object.entries(changes))
    assert.equal(digest(restorePmExecutionShadowSource(file, read(file), true, read)), row.beforeSha, file + ': original HTTP and FOK source unchanged');
}
