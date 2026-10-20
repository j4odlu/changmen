import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
// [changmen 扩展] Three pure modules move intact; old paths share their exact exports.
import assert from 'node:assert/strict';
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import {readAdapterBrowserSource} from './adapter-browser-relocation.mjs';
import {createHash} from 'node:crypto';
import {restoreVenueBrowserContracts,restoreVenueBrowserContractImports,verifyVenueBrowserContracts} from './venue-browser-contracts.mjs';
import {readVenueBrowserStateSource} from './venue-browser-state.mjs';
const normalize=s=>s.replaceAll('\r\n','\n');
const sha=s=>createHash('sha256').update(normalize(s)).digest('hex');
const text=readAdapterHistory(new URL('./venue-browser-leaves.json',import.meta.url),'utf8');
assert.equal(sha(text),'8fb159ff153d54a794b0d001ec5ea9191874825acd3429443863c060a5c538be');
export const VENUE_BROWSER_LEAVES=JSON.parse(text);
const entries=new Map(VENUE_BROWSER_LEAVES.rows.map(row=>[row.file,row]));
function reverseImports(row,source){
 source=normalize(source);assert.equal(sha(source),row.afterSha,row.file+': complete moved source');
 for(const r of row.replacements){assert.equal(source.split(r.to).length,2);source=source.replace(r.to,r.from);}
 assert.equal(sha(source),row.beforeSha,row.file+': complete original source');return source;
}
export function readVenueBrowserLeafSource(file,source,read=target=>readAdapterHistory(new URL('../../'+target,import.meta.url),'utf8')){
 source=readAdapterBrowserSource(file,source,read);
 source=readVenueBrowserStateSource(file,source,read);
 source=restoreVenueBrowserContracts(file,source,read);
 const row=entries.get(file);if(!row)return source;
 assert.equal(normalize(source),row.wrapper,file+': exact leaf facade');
 return reverseImports(row,read(row.canonical));
}
export function restoreVenueBrowserLeafEdits(file,source){
 source=restoreVenueBrowserContractImports(file,source);
 source=normalize(source);
 const row=VENUE_BROWSER_LEAVES.changes.find(row=>row.file===file);
 if(row&&sha(source)===row.afterSha)return reverseImports(row,source);
 const metadata=VENUE_BROWSER_LEAVES.metadata.find(row=>row.file===file);
 if(!metadata||sha(source)!==metadata.afterSha)return source;
 const lines=source.split('\n');
 for(const patch of [...metadata.patches].reverse()){
  assert.equal(patch.before.length,patch.oldCount);assert.equal(patch.after.length,patch.newCount);
  const start=patch.newCount===0?patch.newStart:patch.newStart-1;
  assert.deepEqual(lines.slice(start,start+patch.newCount),patch.after);
  lines.splice(start,patch.newCount,...patch.before);
 }
 const restored=lines.join('\n');assert.equal(sha(restored),metadata.beforeSha);return restored;
}
export function verifyVenueBrowserLeaves(read){
 verifyVenueBrowserContracts(read);
 assert.equal(entries.size,3);
 for(const row of entries.values())readVenueBrowserLeafSource(row.file,read(row.file),read);
 for(const row of [...VENUE_BROWSER_LEAVES.changes,...VENUE_BROWSER_LEAVES.metadata])
  assert.equal(sha(restoreVenueBrowserLeafEdits(row.file,read(row.file))),row.beforeSha,row.file+': full pre-extraction source');
 return {entries:entries.size};
}
