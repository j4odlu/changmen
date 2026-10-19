// [changmen 扩展] Exact package registration and public-entry imports; no business source exemptions.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {restoreVenueBrowserConsumers,verifyVenueBrowserConsumers} from './venue-browser-consumers.mjs';
const normalize=s=>s.replaceAll('\r\n','\n');
const sha=s=>createHash('sha256').update(normalize(s)).digest('hex');
const text=fs.readFileSync(new URL('./venue-browser-workspace.json',import.meta.url),'utf8');
assert.equal(sha(text),'731db4c57d59ece91848c80afa682ec397c5762ba270c7a5079deb9bc7db1546');
export const VENUE_BROWSER_WORKSPACE=JSON.parse(text);
export function restoreVenueBrowserWorkspace(file,source){
 source=restoreVenueBrowserConsumers(file,source);
 source=normalize(source);const row=VENUE_BROWSER_WORKSPACE.changes.find(row=>row.file===file);
 if(!row||sha(source)!==row.afterSha)return source;
 const lines=source.split('\n');
 for(const patch of [...row.patches].reverse()){
  assert.equal(patch.before.length,patch.oldCount);assert.equal(patch.after.length,patch.newCount);
  const start=patch.newCount===0?patch.newStart:patch.newStart-1;
  assert.deepEqual(lines.slice(start,start+patch.newCount),patch.after);
  lines.splice(start,patch.newCount,...patch.before);
 }
 const restored=lines.join('\n');assert.equal(sha(restored),row.beforeSha,file+': complete pre-workspace source');return restored;
}
export function verifyVenueBrowserWorkspace(read){
 verifyVenueBrowserConsumers(read);
 for(const row of VENUE_BROWSER_WORKSPACE.added)assert.equal(sha(restoreVenueBrowserConsumers(row.file,read(row.file))),row.sha,row.file+': exact browser package');
 for(const row of VENUE_BROWSER_WORKSPACE.changes)
  assert.equal(sha(restoreVenueBrowserWorkspace(row.file,read(row.file))),row.beforeSha,row.file+': exact workspace changes');
 return {entries:18,changedFiles:VENUE_BROWSER_WORKSPACE.changes.length};
}
