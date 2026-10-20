import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
// [changmen 扩展] Move the passive stream singleton intact; retain exact historical source checks.
import assert from 'node:assert/strict';
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import {createHash} from 'node:crypto';
import {restoreVenueBrowserQuotes,verifyVenueBrowserQuotes} from './venue-browser-quotes.mjs';
const normalize=s=>s.replaceAll('\r\n','\n');
const sha=s=>createHash('sha256').update(normalize(s)).digest('hex');
const text=readAdapterHistory(new URL('./venue-browser-stream.json',import.meta.url),'utf8');
assert.equal(sha(text),'c40adab9f01344b6a269014cff04f9d138d19fe00302297777ad9667d58a21b6');
export const VENUE_BROWSER_STREAM=JSON.parse(text);
export function restoreVenueBrowserStream(file,source){
 source=restoreVenueBrowserQuotes(file,source);
 source=normalize(source);const row=VENUE_BROWSER_STREAM.changes.find(row=>row.file===file);
 if(!row||sha(source)!==row.afterSha)return source;
 const lines=source.split('\n');
 for(const patch of [...row.patches].reverse()){
  assert.equal(patch.before.length,patch.oldCount);assert.equal(patch.after.length,patch.newCount);
  const start=patch.newCount===0?patch.newStart:patch.newStart-1;
  assert.deepEqual(lines.slice(start,start+patch.newCount),patch.after);
  lines.splice(start,patch.newCount,...patch.before);
 }
 const restored=lines.join('\n');assert.equal(sha(restored),row.beforeSha,file+': complete previous stream consumer');return restored;
}
export function verifyVenueBrowserStream(read){
 verifyVenueBrowserQuotes(read);
 for(const row of VENUE_BROWSER_STREAM.added)assert.equal(sha(read(row.file)),row.sha,row.file+': exact stream implementation');
 for(const row of VENUE_BROWSER_STREAM.changes)
  assert.equal(sha(restoreVenueBrowserStream(row.file,read(row.file))),row.beforeSha,row.file+': exact stream relocation');
 return {changedFiles:6,implementations:1};
}
