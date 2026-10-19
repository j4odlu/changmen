// [changmen 扩展] Exact metadata cache relocation; HTTP remains with the existing host.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {restoreVenueBrowserLifecycle,verifyVenueBrowserLifecycle} from './venue-browser-lifecycle.mjs';
const normalize=s=>s.replaceAll('\r\n','\n');
const sha=s=>createHash('sha256').update(normalize(s)).digest('hex');
const text=fs.readFileSync(new URL('./venue-browser-metadata.json',import.meta.url),'utf8');
assert.equal(sha(text),'f4b8a1959150c8ea2bf6751277a48126a9fe85f8c99e70f4458a3eaa502852cc');
export const VENUE_BROWSER_METADATA=JSON.parse(text);
export function restoreVenueBrowserMetadataCache(file,source){
 source=restoreVenueBrowserLifecycle(file,source);
 source=normalize(source);const row=VENUE_BROWSER_METADATA.changes.find(row=>row.file===file);
 if(!row||sha(source)!==row.afterSha)return source;
 const lines=source.split('\n');
 for(const patch of [...row.patches].reverse()){
  assert.equal(patch.before.length,patch.oldCount);assert.equal(patch.after.length,patch.newCount);
  const start=patch.newCount===0?patch.newStart:patch.newStart-1;
  assert.deepEqual(lines.slice(start,start+patch.newCount),patch.after);
  lines.splice(start,patch.newCount,...patch.before);
 }
 const restored=lines.join('\n');assert.equal(sha(restored),row.beforeSha,file+': complete prior metadata consumer');return restored;
}
export function verifyVenueBrowserMetadataCache(read){
 verifyVenueBrowserLifecycle(read);
 for(const row of VENUE_BROWSER_METADATA.added)assert.equal(sha(read(row.file)),row.sha,row.file+': exact metadata cache');
 for(const row of VENUE_BROWSER_METADATA.changes)
  assert.equal(sha(restoreVenueBrowserMetadataCache(row.file,read(row.file))),row.beforeSha,row.file+': exact metadata relocation');
 return {changedFiles:5,modules:1};
}
