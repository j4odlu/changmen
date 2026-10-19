// [changmen 扩展] Direct browser consumers and one shared Worker composition; preserve historical proofs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {restoreVenueBrowserStream,verifyVenueBrowserStream} from './venue-browser-stream.mjs';
const normalize=s=>s.replaceAll('\r\n','\n');
const sha=s=>createHash('sha256').update(normalize(s)).digest('hex');
const text=fs.readFileSync(new URL('./venue-browser-consumers.json',import.meta.url),'utf8');
assert.equal(sha(text),'45e4e03632a72d0ed64c7286330b31b0fd243667343a199b0f22cccc74fc7981');
export const VENUE_BROWSER_CONSUMERS=JSON.parse(text);
export function restoreVenueBrowserConsumers(file,source){
 source=restoreVenueBrowserStream(file,source);
 source=normalize(source);const row=VENUE_BROWSER_CONSUMERS.changes.find(row=>row.file===file);
 if(!row||sha(source)!==row.afterSha)return source;
 const lines=source.split('\n');
 for(const patch of [...row.patches].reverse()){
  assert.equal(patch.before.length,patch.oldCount);assert.equal(patch.after.length,patch.newCount);
  const start=patch.newCount===0?patch.newStart:patch.newStart-1;
  assert.deepEqual(lines.slice(start,start+patch.newCount),patch.after);
  lines.splice(start,patch.newCount,...patch.before);
 }
 const restored=lines.join('\n');assert.equal(sha(restored),row.beforeSha,file+': complete previous consumer');return restored;
}
export function verifyVenueBrowserConsumers(read){
 verifyVenueBrowserStream(read);
 for(const row of VENUE_BROWSER_CONSUMERS.added)assert.equal(sha(read(row.file)),row.sha,row.file+': exact Worker composition');
 for(const row of VENUE_BROWSER_CONSUMERS.changes)
  assert.equal(sha(restoreVenueBrowserConsumers(row.file,read(row.file))),row.beforeSha,row.file+': exact consumer edits');
 return {changedFiles:10,workers:1};
}
