// [changmen 扩展] Exact client package relocation; original baselines remain authoritative.
import assert from 'node:assert/strict';
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { restoreNodePackageMetadata } from './node-package-relocation.mjs';
import { restoreVenueBrowserExecution } from './venue-browser-execution.mjs';
import { restoreBrowserEntryRetirement, withAdapterHistoryReader } from './browser-entry-history.mjs';

const normalize = text => text.replaceAll('\r\n', '\n');
const sha = text => createHash('sha256').update(normalize(text)).digest('hex');
const text = fs.readFileSync(new URL('./client-package-relocation.json', import.meta.url), 'utf8');
assert.equal(sha(text), 'f80bdec90e4314b38049db2baa5dd8b735d8bad9c07c7ee428793ba799c7562b', 'Reviewed relocation inventory must not drift');
export const CLIENT_PACKAGE_RELOCATION = JSON.parse(text);
assert.equal(CLIENT_PACKAGE_RELOCATION.baselineCommit, 'ce39897bd33ec11a438332323e9419a379517a93');
assert.equal(CLIENT_PACKAGE_RELOCATION.immutableFokBaseline, '75b1efac66625e5f2bc9884a965b244bfaf337ed');
assert.equal(CLIENT_PACKAGE_RELOCATION.publishScopeOptimizationEnabled, false);
assert.equal(CLIENT_PACKAGE_RELOCATION.relocations.length, 39);
const packageHashes = {"client-core":"8cba95ae9af6d8e3c6a580ebb84d31f6be430492e67f51289cc02f91b4cc8dc4","arb-core":"375c8a90b5a8f2b1da6cbc66db4ff79a043da31ad4e55446e10294a6c703363a"};
const entries = new Map(CLIENT_PACKAGE_RELOCATION.relocations.map(row => [row.file, row]));

// Historical callers still compare the complete original module after following
// the exact facade. No prefix exemptions, baseline replacement or duplicate code.
export function readClientPackageSource(file, source, read) {
  const row = entries.get(file);
  if (!row || normalize(source) !== row.wrapper) return source;
  const canonical = normalize(restoreBrowserEntryRetirement(row.canonical, read(row.canonical)));
  assert.equal(sha(canonical), row.sourceSha256, `${row.canonical}: relocated implementation changed`);
  return canonical;
}

export function restoreClientPackageMetadata(file, source) {
  source = restoreNodePackageMetadata(file, source);
  source = normalize(source);
  const row = CLIENT_PACKAGE_RELOCATION.changes.find(change => change.file === file);
  if (!row || sha(source) !== row.migratedSha256) return source;
  const lines = source.split('\n');
  for (const patch of [...row.patches].reverse()) {
    assert.equal(patch.before.length, patch.oldCount);
    assert.equal(patch.after.length, patch.newCount);
    const start = patch.newCount === 0 ? patch.newStart : patch.newStart - 1;
    assert.deepEqual(lines.slice(start, start + patch.newCount), patch.after);
    lines.splice(start, patch.newCount, ...patch.before);
  }
  const restored = lines.join('\n');
  assert.equal(sha(restored), row.baselineSha256, `${file}: entire previous metadata must restore`);
  return restored;
}

export function verifyClientPackageRelocation(read) {
  read = withAdapterHistoryReader(read);
  const certified = new Set();
  for (const row of entries.values()) {
    assert.match(row.file, /^packages\/(?:client-core|arb-core)\/(?:src|scripts)\//);
    assert.equal(row.canonical, `client/${row.file}`);
    assert.equal(normalize(read(row.file)), row.wrapper, `${row.file}: exact compatibility facade required`);
    assert.equal(sha(read(row.canonical)), row.sourceSha256, `${row.canonical}: complete implementation must remain unchanged`);
    certified.add(row.file); certified.add(row.canonical);
  }
  // Compare actual manifests, not only a migration-time checksum. Package names,
  // exports, script commands and external dependency declarations remain intact.
  for (const name of ['client-core', 'arb-core']) {
    assert.equal(sha(read(`packages/${name}/package.json`)), packageHashes[name], 'Original package contract must stay intact');
    const before = JSON.parse(read(`packages/${name}/package.json`));
    const current = JSON.parse(restoreVenueBrowserExecution(`client/packages/${name}/package.json`, read(`client/packages/${name}/package.json`)));
    current.dependencies['@changmen/api-contract'] = 'file:../api-contract';
    if (name === 'client-core') current.dependencies['@changmen/shared'] = 'file:../shared';
    assert.deepEqual(current, before, `${name}: public package contract changed`);
    const actual = JSON.parse(read(`client/packages/${name}/package.json`));
    assert.equal(actual.dependencies['@changmen/api-contract'], 'file:../../../packages/api-contract');
    if (name === 'client-core') assert.equal(actual.dependencies['@changmen/shared'], 'file:../../../packages/shared');
    for (const target of Object.values(actual.exports)) read(`client/packages/${name}/${target.slice(2)}`);
  }
  const root = JSON.parse(read('package.json'));
  for (const name of ['client-core', 'arb-core']) {
    assert(root.workspaces.includes(`client/packages/${name}`));
    assert(!root.workspaces.includes(`packages/${name}`), 'Legacy facade is not a second workspace');
  }
  return certified;
}

export function inspectClientPackageRelocation(root) {
  const read = file => {
    const resolved = fs.realpathSync(path.join(root, file));
    const relative = path.relative(fs.realpathSync(root), resolved);
    assert(!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), 'Relocation escapes workspace');
    return fs.readFileSync(resolved, 'utf8');
  };
  return { entries: verifyClientPackageRelocation(read).size / 2, publishScopeOptimizationEnabled: false };
}
