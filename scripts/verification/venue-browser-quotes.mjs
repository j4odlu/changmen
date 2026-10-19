import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
// [changmen 扩展] Exact market message, book quote and frame parser relocation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {restoreVenueBrowserPricing,verifyVenueBrowserPricing} from './venue-browser-pricing.mjs';
const normalize=s=>s.replaceAll('\r\n','\n');
const sha=s=>createHash('sha256').update(normalize(s)).digest('hex');
const text=readAdapterHistory(new URL('./venue-browser-quotes.json',import.meta.url),'utf8');
assert.equal(sha(text),'82179fdbd02b091e8e9c78999ec8f3fa5e8bf895dfa94fd0d009a05bf8a0ea53');
export const VENUE_BROWSER_QUOTES=JSON.parse(text);
export function restoreVenueBrowserQuotes(file,source){
 source=restoreVenueBrowserPricing(file,source);
 source=normalize(source);const row=VENUE_BROWSER_QUOTES.changes.find(row=>row.file===file);
 if(!row||sha(source)!==row.afterSha)return source;
 const lines=source.split('\n');
 for(const patch of [...row.patches].reverse()){
  assert.equal(patch.before.length,patch.oldCount);assert.equal(patch.after.length,patch.newCount);
  const start=patch.newCount===0?patch.newStart:patch.newStart-1;
  assert.deepEqual(lines.slice(start,start+patch.newCount),patch.after);
  lines.splice(start,patch.newCount,...patch.before);
 }
 const restored=lines.join('\n');assert.equal(sha(restored),row.beforeSha,file+': complete prior quote consumer');return restored;
}
export function verifyVenueBrowserQuotes(read){
 verifyVenueBrowserPricing(read);
 for(const row of VENUE_BROWSER_QUOTES.added)assert.equal(sha(read(row.file)),row.sha,row.file+': exact extracted source');
 for(const row of VENUE_BROWSER_QUOTES.changes)
  assert.equal(sha(restoreVenueBrowserQuotes(row.file,read(row.file))),row.beforeSha,row.file+': exact quote relocation');
 return {changedFiles:7,modules:3};
}
