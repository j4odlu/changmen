import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
// [changmen 扩展] Exact singleton relocation; no factories, duplicate state or new lifecycle hooks.
import assert from 'node:assert/strict';
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import {createHash} from 'node:crypto';
import {restoreVenueBrowserHost,verifyVenueBrowserHost} from './venue-browser-host.mjs';
import {restoreVenueBrowserWorkspace} from './venue-browser-workspace.mjs';
const normalize=s=>s.replaceAll('\r\n','\n');
const sha=s=>createHash('sha256').update(normalize(s)).digest('hex');
const text=readAdapterHistory(new URL('./venue-browser-state.json',import.meta.url),'utf8');
assert.equal(sha(text),'51b22b9581fbc27ac8d34c7d62b3b3a92aadc3931a325db25029242a599f48ba');
export const VENUE_BROWSER_STATE=JSON.parse(text);
const readFile=withAdapterHistoryReader(file=>readAdapterHistory(new URL('../../'+file,import.meta.url),'utf8'));
function reverse(row,source){
 source=normalize(source);assert.equal(sha(source),row.afterSha,row.file+': complete relocated state source');
 for(const r of row.replacements){assert.equal(source.split(r.to).length,2);source=source.replace(r.to,r.from);}
 assert.equal(sha(source),row.beforeSha,row.file+': complete original state source');return source;
}
export function readVenueBrowserStateSource(file,source,read=readFile){
 source=restoreVenueBrowserWorkspace(file,source);
 const row=VENUE_BROWSER_STATE.rows.find(row=>row.file===file);if(!row)return source;
 assert.equal(normalize(source),row.wrapper,file+': exact state facade');
 return reverse(row,read(row.canonical));
}
export function restoreVenueBrowserStateEdits(file,source){
 source=restoreVenueBrowserHost(file,source);
 source=normalize(source);const row=VENUE_BROWSER_STATE.changes.find(row=>row.file===file);
 return row&&sha(source)===row.afterSha?reverse(row,source):source;
}
export function verifyVenueBrowserState(read){
 verifyVenueBrowserHost(read);
 assert.equal(VENUE_BROWSER_STATE.rows.length,2);
 for(const row of VENUE_BROWSER_STATE.rows)readVenueBrowserStateSource(row.file,read(row.file),read);
 for(const row of VENUE_BROWSER_STATE.changes)
  assert.equal(sha(restoreVenueBrowserStateEdits(row.file,read(row.file))),row.beforeSha,row.file+': complete prior consumer or inventory');
 return {entries:2};
}
