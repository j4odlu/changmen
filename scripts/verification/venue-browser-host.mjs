import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
// [changmen 扩展] Exact host composition and pure callback binding; historical proofs remain fixed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {restoreVenueBrowserWorkspace,verifyVenueBrowserWorkspace} from './venue-browser-workspace.mjs';
const normalize=s=>s.replaceAll('\r\n','\n');
const sha=s=>createHash('sha256').update(normalize(s)).digest('hex');
const text=readAdapterHistory(new URL('./venue-browser-host.json',import.meta.url),'utf8');
assert.equal(sha(text),'15bc3d164711fcafc7d1db888833b42a651b1f5d9c0e2416acc10a6032e1bd2e');
export const VENUE_BROWSER_HOST=JSON.parse(text);
const readFile=withAdapterHistoryReader(file=>readAdapterHistory(new URL('../../'+file,import.meta.url),'utf8'));
function reverse(row,source){
 source=normalize(source);assert.equal(sha(source),row.afterSha,row.file+': exact host boundary');
 for(const r of row.replacements){assert.equal(source.split(r.to).length,2);source=source.replace(r.to,r.from);}
 assert.equal(sha(source),row.beforeSha,row.file+': complete previous source');return source;
}
export function restoreVenueBrowserHost(file,source,read=readFile){
 source=restoreVenueBrowserWorkspace(file,source);
 source=normalize(source);const row=VENUE_BROWSER_HOST.changes.find(row=>row.file===file);
 if(!row||sha(source)!==row.afterSha)return source;
 for(const added of VENUE_BROWSER_HOST.added)assert.equal(sha(restoreVenueBrowserWorkspace(added.file,read(added.file))),added.sha,added.file+': exact singleton composition');
 return reverse(row,source);
}
export function verifyVenueBrowserHost(read){
 verifyVenueBrowserWorkspace(read);
 assert.equal(VENUE_BROWSER_HOST.changes.length,3);assert.equal(VENUE_BROWSER_HOST.added.length,1);
 for(const row of VENUE_BROWSER_HOST.added)assert.equal(sha(restoreVenueBrowserWorkspace(row.file,read(row.file))),row.sha,row.file+': exact singleton composition');
 for(const row of VENUE_BROWSER_HOST.changes)reverse(row,restoreVenueBrowserWorkspace(row.file,read(row.file)));
 return {hostEntries:1,restoredFiles:3};
}
