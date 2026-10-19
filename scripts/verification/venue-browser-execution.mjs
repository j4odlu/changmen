import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
// [changmen 扩展] Exact closed market execution dependency group relocation.
import {restoreVenueBrowserAccountRuntime,verifyVenueBrowserAccountRuntime} from './venue-browser-account-runtime.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const normalize=s=>s.replaceAll('\r\n','\n');
const sha=s=>createHash('sha256').update(normalize(s)).digest('hex');
const text=readAdapterHistory(new URL('./venue-browser-execution.json',import.meta.url),'utf8');
assert.equal(sha(text),'9ff84b25713efb8108c2088b2b49a2deeb97ca128e62891e2fde49464ed7d7c3');
export const VENUE_BROWSER_EXECUTION=JSON.parse(text);
export function restoreVenueBrowserExecution(file,source){
 source=restoreVenueBrowserAccountRuntime(file,source);
 source=normalize(source);const row=VENUE_BROWSER_EXECUTION.changes.find(row=>row.file===file);
 if(!row||sha(source)!==row.afterSha)return source;
 const lines=source.split('\n');
 for(const patch of [...row.patches].reverse()){
  assert.equal(patch.before.length,patch.oldCount);assert.equal(patch.after.length,patch.newCount);
  const start=patch.newCount===0?patch.newStart:patch.newStart-1;
  assert.deepEqual(lines.slice(start,start+patch.newCount),patch.after);
  lines.splice(start,patch.newCount,...patch.before);
 }
 const restored=lines.join('\n');assert.equal(sha(restored),row.beforeSha,file+': complete prior execution consumer');return restored;
}
export function verifyVenueBrowserExecution(read){
 verifyVenueBrowserAccountRuntime(read);
 for(const row of VENUE_BROWSER_EXECUTION.added)assert.equal(sha(read(row.file)),row.sha,row.file+': exact execution source');
 for(const row of VENUE_BROWSER_EXECUTION.changes)
  assert.equal(sha(restoreVenueBrowserExecution(row.file,read(row.file))),row.beforeSha,row.file+': exact execution relocation');
 return {changedFiles:81,modules:72};
}
