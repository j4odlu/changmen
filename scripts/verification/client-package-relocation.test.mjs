// [changmen 扩展] Exercise both implementations and reject partial or redirected migrations.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';
import { CLIENT_PACKAGE_RELOCATION as policy, verifyClientPackageRelocation, readClientPackageSource, restoreClientPackageMetadata } from './client-package-relocation.mjs';
import { isVersionSource } from '../../devtools/runtime-tooling/runtime_version.js';
import { classifyDeployScope } from '../deploy/classify-deploy-scope.mjs';

const read = file => fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
const sha = text => createHash('sha256').update(text).digest('hex');
const original = file => execFileSync('git', ['show', `${policy.baselineCommit}:${file}`], { encoding: 'utf8', windowsHide: true }).replaceAll('\r\n', '\n');

it('keeps every original runtime byte at its single canonical location', () => {
  expect(verifyClientPackageRelocation(read).size).toBe(78);
  const runtime = policy.relocations.filter(row => row.kind === 'runtime');
  expect(runtime).toHaveLength(36);
  for (const row of runtime) {
    const baseline = original(row.file);
    expect(read(row.canonical)).toBe(baseline);
    expect(sha(baseline)).toBe(row.sourceSha256);
    expect(readClientPackageSource(row.file, read(row.file), read)).toBe(baseline);
  }
}, 30_000);

describe.each(policy.relocations.map(row => [row.file, row]))('%s', (_file, row) => {
  it('rejects changed or missing canonical implementation', () => {
    expect(() => verifyClientPackageRelocation(file => file === row.canonical ? read(file) + '\nvoid unreviewed();\n' : read(file))).toThrow();
    expect(() => verifyClientPackageRelocation(file => { if (file === row.canonical) throw Error('missing'); return read(file); })).toThrow();
  });
  it('rejects a redirected facade or a second implementation at the old path', () => {
    for (const replacement of [row.wrapper.replace('client/packages/', 'other/packages/'), read(row.canonical)])
      expect(() => verifyClientPackageRelocation(file => file === row.file ? replacement : read(file))).toThrow();
  });
});

it.each(policy.changes.map(row => [row.file, row]))('restores complete prior metadata: %s', (file, row) => {
  const current = read(file), previous = original(file);
  expect(sha(previous)).toBe(row.baselineSha256);
  expect(restoreClientPackageMetadata(file, current)).toBe(previous);
  expect(restoreClientPackageMetadata(file, current + '\n')).not.toBe(previous);
});

it('retains conservative publication and both Git/archive runtime source coverage', () => {
  for (const row of policy.relocations) {
    expect(isVersionSource(row.canonical, 'frontend')).toBe(true);
    expect(isVersionSource(row.canonical, 'backend')).toBe(true);
    expect(classifyDeployScope([row.canonical])).toBe('full');
  }
});

it('shares bridge state and exported function identity across old, new and package entries', async () => {
  for (const [file, spec] of [
    ['bridge/oddsAccess.ts', '@changmen/client-core/bridge/oddsAccess'],
    ['bridge/clientApi.ts', '@changmen/client-core/bridge/clientApi'],
    ['bridge/bettingLog.ts', '@changmen/client-core/bridge/bettingLog'],
  ]) {
    const old = await import(/* @vite-ignore */ `../../packages/client-core/src/${file}`);
    const current = await import(/* @vite-ignore */ `../../client/packages/client-core/src/${file}`);
    const pkg = await import(/* @vite-ignore */ spec);
    expect(Object.keys(old)).toEqual(Object.keys(current));
    for (const key of Object.keys(old)) { expect(old[key]).toBe(current[key]); expect(pkg[key]).toBe(current[key]); }
  }
});

it('retains native Node resolution of both package exports at their canonical locations', () => {
  const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e',
    'console.log(JSON.stringify([import.meta.resolve("@changmen/client-core/shared/http"),import.meta.resolve("@changmen/arb-core/arbitrage/pickArbLegs")]))'],
  { encoding: 'utf8', windowsHide: true }));
  expect(result[0]).toContain('/client/packages/client-core/src/shared/http.ts');
  expect(result[1]).toContain('/client/packages/arb-core/src/arbitrage/pickArbLegs.ts');
});

it('typechecks canonical packages and legacy forwarding entries with their own configs', () => {
  for (const prefix of ['packages', 'client/packages']) {
    for (const name of ['client-core', 'arb-core']) {
      execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', `${prefix}/${name}/tsconfig.json`, '--pretty', 'false'],
        { encoding: 'utf8', windowsHide: true });
    }
  }
}, 30000);
