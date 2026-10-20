import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
const script = fs.readFileSync(new URL('./capture-vps-fok-baseline.mjs', import.meta.url), 'utf8');
const encoded = script.slice(script.indexOf('function assets('), script.indexOf('\n`;'));
const program = vm.runInNewContext('`' + encoded + '`');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function capture(files) {
  const frontend = fs.mkdtempSync(path.join(os.tmpdir(), 'changmen-current-assets-'));
  try {
    for (const [file, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(frontend, file)), { recursive: true });
      fs.writeFileSync(path.join(frontend, file), text);
    }
    let result;
    const io = { ...fs, readFileSync: (file, ...args) => {
      if (path.basename(file).startsWith('historical-')) throw Error('Unused history must not be read');
      return fs.readFileSync(file, ...args);
    } };
    vm.runInNewContext(program, { frontend, fs: io, path, sha, layout: {}, hashes: {}, sources: {}, Date,
      console: { log: text => { result = JSON.parse(text); } } });
    return result;
  } finally { fs.rmSync(frontend, { recursive: true, force: true }); }
}
it('captures every nested current asset byte for byte while leaving unused historical chunks unread', () => {
  const current = { 'index.html': '<script src="current.js"></script><link href="current.css">',
    'deploy-version.txt': 'verified commit', 'assets/current.js': 'import("nested.js");',
    'assets/nested.js': 'const image="current.svg";', 'assets/current.css': 'a{background:url(current.svg)}',
    'assets/current.svg': '<svg></svg>' };
  const history = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`assets/historical-${i}.js`, 'old data']));
  const result = capture({ ...current, ...history });
  expect(result.storedAssetCount).toBe(206);
  expect(result.assets).toEqual(result.reachableAssets);
  expect(result.assets.map(row => row.file).sort()).toEqual(Object.keys(current).sort());
  for (const row of result.assets) {
    expect(row.sha256).toBe(sha(Buffer.from(current[row.file])));
    expect(row.bytes).toBe(Buffer.byteLength(current[row.file]));
  }
});
it('changed nested current bytes always change the captured fingerprint', () => {
  const files = { 'index.html': '<script src="current.js"></script>', 'deploy-version.txt': 'commit',
    'assets/current.js': 'import("nested.js")', 'assets/nested.js': 'original code' };
  const before = capture(files), after = capture({ ...files, 'assets/nested.js': 'changed code' });
  expect(after.reachableAssets.find(row => row.file === 'assets/nested.js').sha256)
    .not.toBe(before.reachableAssets.find(row => row.file === 'assets/nested.js').sha256);
});
