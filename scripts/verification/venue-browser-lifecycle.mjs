import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
// [changmen 扩展] Exact closed market lifecycle dependency group relocation.
import assert from 'node:assert/strict';
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import {createHash} from 'node:crypto';
import {restoreVenueBrowserExecution,verifyVenueBrowserExecution} from './venue-browser-execution.mjs';
const normalize=s=>s.replaceAll('\r\n','\n');
const sha=s=>createHash('sha256').update(normalize(s)).digest('hex');
const text=readAdapterHistory(new URL('./venue-browser-lifecycle.json',import.meta.url),'utf8');
assert.equal(sha(text),'60165fc854eee1664505f333d7dfda300ada2f9beec417f2ea17effa4fc346a7');
export const VENUE_BROWSER_LIFECYCLE=JSON.parse(text);
export function restoreVenueBrowserLifecycle(file,source){
 source=restoreVenueBrowserExecution(file,source);
 source=normalize(source);const row=VENUE_BROWSER_LIFECYCLE.changes.find(row=>row.file===file);
 if(!row||sha(source)!==row.afterSha)return source;
 const lines=source.split('\n');
 for(const patch of [...row.patches].reverse()){
  assert.equal(patch.before.length,patch.oldCount);assert.equal(patch.after.length,patch.newCount);
  const start=patch.newCount===0?patch.newStart:patch.newStart-1;
  assert.deepEqual(lines.slice(start,start+patch.newCount),patch.after);
  lines.splice(start,patch.newCount,...patch.before);
 }
 const restored=lines.join('\n');assert.equal(sha(restored),row.beforeSha,file+': complete prior lifecycle consumer');return restored;
}
export function verifyVenueBrowserLifecycle(read){
 verifyVenueBrowserExecution(read);
 for(const row of VENUE_BROWSER_LIFECYCLE.added)assert.equal(sha(read(row.file)),row.sha,row.file+': exact lifecycle source');
 for(const row of VENUE_BROWSER_LIFECYCLE.changes)
  assert.equal(sha(restoreVenueBrowserLifecycle(row.file,read(row.file))),row.beforeSha,row.file+': exact lifecycle relocation');
 return {changedFiles:26,modules:19};
}
