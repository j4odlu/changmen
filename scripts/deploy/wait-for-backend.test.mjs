import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import YAML from 'yaml';
import { needsBackendRelease, waitForBackend } from './wait-for-backend.mjs';

const sha = 'a'.repeat(40);
const run = (extra = {}) => ({ databaseId: 1, headSha: sha, headBranch: 'master', status: 'completed', conclusion: 'success', ...extra });
const patterns = YAML.parse(readFileSync(new URL('../../.github/workflows/deploy-backend.yml', import.meta.url), 'utf8')).on.push.paths;
test('frontend-only stays independent; shared/API/deployment changes wait', () => {
  assert.equal(needsBackendRelease(['client/web/src/App.vue', 'docs/README.md'], patterns), false);
  for (const path of ['packages/venue-adapter/polymarket/bet.ts', 'server/backend/server.js',
    'scripts/deploy/wait-for-backend.mjs', 'package-lock.json', '.github/workflows/deploy-backend.yml'])
    assert.equal(needsBackendRelease([path], patterns), true, path);
});
test('absent, queued and running backend are awaited before success', async () => {
  let time = 0;
  const states = [[], [run({ status: 'queued', conclusion: '' })], [run({ status: 'in_progress', conclusion: '' })], [run()]];
  await waitForBackend({ sha, listRuns: () => states.shift(), now: () => time, sleep: async ms => { time += ms; }, log() {} });
  assert.equal(states.length, 0);
  assert.equal(time, 45_000);
});
test('other commit or branch cannot release the frontend; absence times out', async () => {
  let time = 0;
  await assert.rejects(waitForBackend({ sha, listRuns: () => [run({ headSha: 'b'.repeat(40) }), run({ headBranch: 'test' })],
    now: () => time, sleep: async ms => { time += ms; }, timeoutMs: 30_000, log() {} }), /Timed out/);
});
test('latest failed/cancelled/skipped backend stops publication despite older success', async () => {
  for (const conclusion of ['failure', 'cancelled', 'skipped', 'timed_out'])
    await assert.rejects(waitForBackend({ sha, listRuns: () => [run(), run({ databaseId: 2, conclusion })],
      sleep: async () => { throw new Error('must not sleep'); }, log() {} }), /did not succeed/);
});
test('API lookup failures stop publication', async () => {
  await assert.rejects(waitForBackend({ sha, listRuns: () => { throw new Error('lookup failed'); }, sleep: async () => {}, log() {} }), /lookup failed/);
});
