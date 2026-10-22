import fs from 'node:fs';
import {expect, it} from 'vitest';
import {restoreVenueChunkPolicySource, verifyVenueChunkPolicySources} from './venue-chunk-policy-boundary.mjs';

const record = JSON.parse(fs.readFileSync(new URL('./venue-chunk-policy-increment.json', import.meta.url), 'utf8'));
const read = file => fs.readFileSync(file, 'utf8');

it('restores only the exact build policy increment to the complete original config', () => {
  expect(verifyVenueChunkPolicySources(read)).toEqual({files: 3});
  expect(restoreVenueChunkPolicySource(record.file, read(record.file))).toBe(record.before);
  expect(restoreVenueChunkPolicySource(record.file, record.before)).toBe(record.before);
  const changed = read(record.file) + '\nvoid unreviewedChange();';
  expect(restoreVenueChunkPolicySource(record.file, changed)).toBe(changed);
  expect(() => verifyVenueChunkPolicySources(file => file === record.file ? changed : read(file))).toThrow('reviewed venue chunk policy');
});

it('rejects changes to the policy implementation or cycle guard', () => {
  for (const row of record.implementations)
    expect(() => verifyVenueChunkPolicySources(file => read(file) + (file === row.file ? '\nvoid 0;' : '')))
      .toThrow('reviewed chunk policy implementation');
});

it('does not rewrite trading sources or other verification files', () => {
  expect(restoreVenueChunkPolicySource('client/packages/venue-browser/adapter/predictfun/bet.ts', 'changed')).toBe('changed');
  expect(restoreVenueChunkPolicySource('scripts/verification/browser-entry-history.mjs', 'changed')).toBe('changed');
});
