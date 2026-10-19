import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
// [changmen 扩展] Exact physical relocation, without changing runtime behavior or release scope.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {adapterBrowserSourceReader} from './adapter-browser-relocation.mjs';
import {createHash} from 'node:crypto';
import {restoreVenueBrowserLeafEdits,verifyVenueBrowserLeaves} from './venue-browser-leaves.mjs';
import {restoreVenueBrowserHost} from './venue-browser-host.mjs';
const normalize=source=>source.replaceAll('\r\n','\n');
const sha=source=>createHash('sha256').update(normalize(source)).digest('hex');
const text=readAdapterHistory(new URL('./venue-browser-relocation.json',import.meta.url),'utf8');
assert.equal(sha(text),'3a5842621332faa9a5afcb9522c1b259081109b16876e612bbcdc91d8114033c');
export const VENUE_BROWSER_RELOCATION=JSON.parse(text);
export function restoreVenueBrowserMetadata(file,source){
 source=restoreVenueBrowserLeafEdits(file,source);
 source=normalize(source);
 const row=VENUE_BROWSER_RELOCATION.changes.find(row=>row.file===file);
 if(!row||sha(source)!==row.afterSha)return source;
 const lines=source.split('\n');
 for(const patch of [...row.patches].reverse()){
  assert.equal(patch.before.length,patch.oldCount);assert.equal(patch.after.length,patch.newCount);
  const start=patch.newCount===0?patch.newStart:patch.newStart-1;
  assert.deepEqual(lines.slice(start,start+patch.newCount),patch.after);
  lines.splice(start,patch.newCount,...patch.before);
 }
 const restored=lines.join('\n');assert.equal(sha(restored),row.beforeSha);return restored;
}
export function restoreVenueBrowserSource(row,source){
 source=restoreVenueBrowserLeafEdits(row.canonical,source);
 source=normalize(source);assert.equal(sha(source),row.afterSha,row.canonical+': complete relocated source');
 for(const replacement of [...new Map(row.replacements.map(r=>[r.to,r])).values()])source=source.split(replacement.to).join(replacement.from);
 assert.equal(sha(source),row.beforeSha,row.file+': complete original source');return source;
}
export function verifyVenueBrowserRelocation(read){
 read=adapterBrowserSourceReader(read);
 verifyVenueBrowserLeaves(read);
 assert.equal(VENUE_BROWSER_RELOCATION.rows.length,10);
 for(const row of VENUE_BROWSER_RELOCATION.rows){
  assert.equal(normalize(restoreVenueBrowserHost(row.file,read(row.file),read)),row.wrapper,row.file+': exact forwarding entry');
  restoreVenueBrowserSource(row,read(row.canonical));
 }
 return {entries:10,publishScopeOptimizationEnabled:false};
}
export function inspectVenueBrowserRelocation(root){
 const base=fs.realpathSync(root);
 return verifyVenueBrowserRelocation(file=>{
  const target=fs.realpathSync(path.join(base,file)),relative=path.relative(base,target);
  assert(relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative),'Browser relocation escapes workspace');
  return readAdapterHistory(target,'utf8');
 });
}
