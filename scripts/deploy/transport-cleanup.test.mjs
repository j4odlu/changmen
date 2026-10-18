import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('transport cleanup covers upload/activation failures, live locks, signals and path refusal', () => {
  const bash = process.platform === 'win32' ? 'C:/msys64/usr/bin/bash.exe' : 'bash';
  const result = spawnSync(bash, ['scripts/deploy/transport-cleanup.test.sh'], {
    encoding: 'utf8', timeout: 60000, windowsHide: true,
    env: { ...process.env, ...(process.platform === 'win32' ? { MSYS: 'winsymlinks:nativestrict' } : {}) },
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PASS transport cleanup: 12 scenarios/);
});
