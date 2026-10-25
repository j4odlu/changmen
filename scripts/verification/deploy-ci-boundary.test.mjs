import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {expect, it} from 'vitest';
import {restoreDeployCiSource} from './deploy-ci-boundary.mjs';
import {WORKSPACE_LAYOUT_RELOCATION as record} from './workspace-layout-history.mjs';

for (const file of ['scripts/deploy/workflows.test.mjs', 'scripts/deploy/release-evidence.test.mjs', 'scripts/deploy/release-checks.test.mjs']) {
  it(`${file}: retains the original migration evidence independently of current CI tests`, () => {
    const source = fs.readFileSync(file, 'utf8');
    const original = record.files.find(row => row.canonical === file);
    const restored = restoreDeployCiSource(file, source);
    expect(restored).not.toBe(source.replaceAll('\r\n', '\n'));
    expect(createHash('sha256').update(restored).digest('hex')).toBe(original.afterSha);
    // Existing evidence remains the authority; no baseline is regenerated.
    expect(restoreDeployCiSource(file, original.before)).toBe(file==='scripts/deploy/release-evidence.test.mjs'?original.before:restored);
    expect(restoreDeployCiSource(file, source.replace(/\r?\n/g, '\r\n'))).toBe(restored);
    for (const changed of [source + '\n// unreviewed', source.replace('assert.equal', 'assert.notEqual')])
      expect(restoreDeployCiSource(file, changed)).toBe(file==='scripts/deploy/release-evidence.test.mjs'?changed:restored);
  });
}
it('leaves unrelated source untouched', () => {
  expect(restoreDeployCiSource('server/backend/server.js', 'changed')).toBe('changed');
});
