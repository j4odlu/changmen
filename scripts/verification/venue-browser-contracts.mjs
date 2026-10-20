import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
// [changmen 扩展] Move exact type/predicate/error declarations; retain every original statement.
import assert from 'node:assert/strict';
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import {createHash} from 'node:crypto';
import {restoreVenueBrowserStateEdits,verifyVenueBrowserState} from './venue-browser-state.mjs';
import {restoreVenueBrowserWorkspace} from './venue-browser-workspace.mjs';
const normalize=s=>s.replaceAll('\r\n','\n');
const sha=s=>createHash('sha256').update(normalize(s)).digest('hex');
const text=readAdapterHistory(new URL('./venue-browser-contracts.json',import.meta.url),'utf8');
assert.equal(sha(text),'90c57cbd272a83e264913e3332786d6e3f5d8b4aefc7715a8af6e342a9469c35');
export const VENUE_BROWSER_CONTRACTS=JSON.parse(text);
const readFile=withAdapterHistoryReader(file=>readAdapterHistory(new URL('../../'+file,import.meta.url),'utf8'));
export function restoreVenueBrowserContracts(file,source,read=readFile){
 source=restoreVenueBrowserWorkspace(file,source);
 source=normalize(source);
 const row=VENUE_BROWSER_CONTRACTS.rows.find(row=>row.file===file);
 if(!row||sha(source)!==row.afterSha)return source;
 const canonical=normalize(read(row.canonical));
 assert.equal(sha(canonical),row.canonicalSha,row.canonical+': complete extracted declaration');
 assert.equal(canonical,row.prefix+row.fragment,row.canonical+': exact original declaration');
 assert.equal(source.split(row.replacement).length,2,file+': exact import and re-export');
 const restored=source.replace(row.replacement,canonical.slice(row.prefix.length));
 assert.equal(sha(restored),row.beforeSha,file+': complete original implementation');return restored;
}
export function restoreVenueBrowserContractImports(file,source){
 source=restoreVenueBrowserStateEdits(file,source);
 source=normalize(source);
 const row=VENUE_BROWSER_CONTRACTS.changes.find(row=>row.file===file);
 if(!row||sha(source)!==row.afterSha)return source;
 for(const r of row.replacements){assert.equal(source.split(r.to).length,2);source=source.replace(r.to,r.from);}
 assert.equal(sha(source),row.beforeSha,file+': only registered consumer import edits');return source;
}
export function verifyVenueBrowserContracts(read){
 verifyVenueBrowserState(read);
 assert.equal(VENUE_BROWSER_CONTRACTS.rows.length,3);
 for(const row of VENUE_BROWSER_CONTRACTS.rows)
  assert.equal(sha(restoreVenueBrowserContracts(row.file,read(row.file),read)),row.beforeSha,row.file+': original source remains protected');
 for(const row of VENUE_BROWSER_CONTRACTS.changes)
  assert.equal(sha(restoreVenueBrowserContractImports(row.file,read(row.file))),row.beforeSha,row.file+': original consumer remains protected');
 return {entries:3};
}
