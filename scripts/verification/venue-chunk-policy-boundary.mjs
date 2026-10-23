// Exact build-policy increment; original migration/FOK inventories remain unchanged.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {restorePmWalletAddressOptimizationSource} from './pm-wallet-address-optimization.mjs';
import {restorePmSdkRetirementSource} from './pm-sdk-retirement.mjs';
import {restorePfMarketIdSource,verifyPfMarketIdSource} from './pf-market-id-boundary.mjs';

const normalize = source => source.replaceAll('\r\n', '\n');
const sha = source => createHash('sha256').update(normalize(source)).digest('hex');
const text = fs.readFileSync(new URL('./venue-chunk-policy-increment.json', import.meta.url), 'utf8');
assert.equal(sha(text), '3569a1d087962f76ff0f052c9cec491c6eaea68ab937e8a19510ef58026556aa', 'Venue chunk policy evidence changed');
const record = JSON.parse(text);
assert.equal(record.purpose, 'pm-pf-chunk-policy-repair');
assert.equal(sha(record.before), record.beforeSha, 'Original build policy must remain verifiable');

export function restoreVenueChunkPolicySource(file, source) {
  source = restorePfMarketIdSource(file, source);
  source = restorePmSdkRetirementSource(file, source);
  if (file !== record.file || sha(source) !== record.afterSha) return source;
  return record.before;
}

export function verifyVenueChunkPolicySources(read) {
  verifyPfMarketIdSource(read);
  assert.equal(sha(restorePmSdkRetirementSource(record.file, read(record.file), read)), record.afterSha, 'Only the reviewed venue chunk policy increment is authorized');
  for (const row of record.implementations)
    assert.equal(sha(restorePmWalletAddressOptimizationSource(row.file, read(row.file))), row.sha, row.file + ': reviewed chunk policy implementation');
  return {files: record.implementations.length + 1};
}
