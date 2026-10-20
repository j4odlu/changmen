import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
// [changmen 扩展] Exact closed market account runtime dependency group relocation.
import {restoreVenueBrowserMarketHosts,verifyVenueBrowserMarketHosts} from './venue-browser-market-hosts.mjs';
import assert from 'node:assert/strict';
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import {createHash} from 'node:crypto';
const normalize=s=>s.replaceAll('\r\n','\n');
const sha=s=>createHash('sha256').update(normalize(s)).digest('hex');
const text=readAdapterHistory(new URL('./venue-browser-account-runtime.json',import.meta.url),'utf8');
assert.equal(sha(text),'96480ca43714048fb576bbf2ef413481d0fd793b27a81cf8204de3cfd582254d');
export const VENUE_BROWSER_ACCOUNT_RUNTIME=JSON.parse(text);
export function restoreVenueBrowserAccountRuntime(file,source){
 source=restoreVenueBrowserMarketHosts(file,source);
 source=normalize(source);const row=VENUE_BROWSER_ACCOUNT_RUNTIME.changes.find(row=>row.file===file);
 if(!row||sha(source)!==row.afterSha)return source;
 const lines=source.split('\n');
 for(const patch of [...row.patches].reverse()){
  assert.equal(patch.before.length,patch.oldCount);assert.equal(patch.after.length,patch.newCount);
  const start=patch.newCount===0?patch.newStart:patch.newStart-1;
  assert.deepEqual(lines.slice(start,start+patch.newCount),patch.after);
  lines.splice(start,patch.newCount,...patch.before);
 }
 const restored=lines.join('\n');assert.equal(sha(restored),row.beforeSha,file+': complete prior account runtime consumer');return restored;
}
export function verifyVenueBrowserAccountRuntime(read){
 verifyVenueBrowserMarketHosts(read);
 for(const row of VENUE_BROWSER_ACCOUNT_RUNTIME.added)assert.equal(sha(read(row.file)),row.sha,row.file+': exact account runtime source');
 for(const row of VENUE_BROWSER_ACCOUNT_RUNTIME.changes)
  assert.equal(sha(restoreVenueBrowserAccountRuntime(row.file,read(row.file))),row.beforeSha,row.file+': exact account runtime relocation');
 return {changedFiles:14,modules:8};
}
