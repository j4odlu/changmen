import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
// [changmen 扩展] Exact pure pricing relocation and public consumer imports.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {restoreVenueBrowserMetadataCache,verifyVenueBrowserMetadataCache} from './venue-browser-metadata.mjs';
const normalize=s=>s.replaceAll('\r\n','\n');
const sha=s=>createHash('sha256').update(normalize(s)).digest('hex');
const text=readAdapterHistory(new URL('./venue-browser-pricing.json',import.meta.url),'utf8');
assert.equal(sha(text),'ec6c5876d57c7554d988e8c2167c409a47df643e318eee3dcd7d62a94ec557d9');
export const VENUE_BROWSER_PRICING=JSON.parse(text);
export function restoreVenueBrowserPricing(file,source){
 source=restoreVenueBrowserMetadataCache(file,source);
 source=normalize(source);const row=VENUE_BROWSER_PRICING.changes.find(row=>row.file===file);
 if(!row||sha(source)!==row.afterSha)return source;
 const lines=source.split('\n');
 for(const patch of [...row.patches].reverse()){
  assert.equal(patch.before.length,patch.oldCount);assert.equal(patch.after.length,patch.newCount);
  const start=patch.newCount===0?patch.newStart:patch.newStart-1;
  assert.deepEqual(lines.slice(start,start+patch.newCount),patch.after);
  lines.splice(start,patch.newCount,...patch.before);
 }
 const restored=lines.join('\n');assert.equal(sha(restored),row.beforeSha,file+': complete prior pricing consumer');return restored;
}
export function verifyVenueBrowserPricing(read){
 verifyVenueBrowserMetadataCache(read);
 for(const row of VENUE_BROWSER_PRICING.added)assert.equal(sha(read(row.file)),row.sha,row.file+': exact pricing source');
 for(const row of VENUE_BROWSER_PRICING.changes)
  assert.equal(sha(restoreVenueBrowserPricing(row.file,read(row.file))),row.beforeSha,row.file+': exact pricing relocation');
 return {changedFiles:11,modules:1};
}
