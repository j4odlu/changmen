import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
// [changmen 扩展] Exact closed market market hosts dependency group relocation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {restoreAdapterBrowserMetadata,readAdapterBrowserSource} from './adapter-browser-relocation.mjs';
import {createHash} from 'node:crypto';
const normalize=s=>s.replaceAll('\r\n','\n');
const sha=s=>createHash('sha256').update(normalize(s)).digest('hex');
const text=readAdapterHistory(new URL('./venue-browser-market-hosts.json',import.meta.url),'utf8');
assert.equal(sha(text),'b4ef93a219a1660e287e1eccbaed617d4b1e9e648a85d7e1347ad0cbb6db75bb');
export const VENUE_BROWSER_MARKET_HOSTS=JSON.parse(text);
export function restoreVenueBrowserMarketHosts(file,source){
 source=readAdapterBrowserSource(file,restoreAdapterBrowserMetadata(file,source));
 source=normalize(source);const row=VENUE_BROWSER_MARKET_HOSTS.changes.find(row=>row.file===file);
 if(!row||sha(source)!==row.afterSha)return source;
 const lines=source.split('\n');
 for(const patch of [...row.patches].reverse()){
  assert.equal(patch.before.length,patch.oldCount);assert.equal(patch.after.length,patch.newCount);
  const start=patch.newCount===0?patch.newStart:patch.newStart-1;
  assert.deepEqual(lines.slice(start,start+patch.newCount),patch.after);
  lines.splice(start,patch.newCount,...patch.before);
 }
 const restored=lines.join('\n');assert.equal(sha(restored),row.beforeSha,file+': complete prior market hosts consumer');return restored;
}
export function verifyVenueBrowserMarketHosts(read){
 for(const row of VENUE_BROWSER_MARKET_HOSTS.added)assert.equal(sha(read(row.file)),row.sha,row.file+': exact market hosts source');
 for(const row of VENUE_BROWSER_MARKET_HOSTS.changes)
  assert.equal(sha(restoreVenueBrowserMarketHosts(row.file,read(row.file))),row.beforeSha,row.file+': exact market hosts relocation');
 return {changedFiles:14,modules:9};
}
