import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {VENUE_BROWSER_STATE as record,readVenueBrowserStateSource,restoreVenueBrowserStateEdits,verifyVenueBrowserState} from './venue-browser-state.mjs';
const read=withAdapterHistoryReader(file=>readAdapterHistory(file,'utf8').replaceAll('\r\n','\n'));
const original=file=>execFileSync('git',['show',record.baseline+':'+file],{encoding:'utf8',windowsHide:true}).replaceAll('\r\n','\n');
const sha=s=>createHash('sha256').update(s).digest('hex');
it('preserves both complete state implementations, including initialization and listener cleanup',()=>{
 expect(verifyVenueBrowserState(read)).toEqual({entries:2});
 for(const row of record.rows)expect(readVenueBrowserStateSource(row.file,read(row.file),read)).toBe(original(row.file));
});
it('rejects missing state, changed initialization and non-forwarding old entries',()=>{
 for(const row of record.rows){
  for(const target of [row.file,row.canonical]){
   expect(()=>verifyVenueBrowserState(file=>read(file)+(file===target?'\nvoid duplicateState();\n':''))).toThrow();
   expect(()=>verifyVenueBrowserState(file=>{if(file===target)throw Error('missing');return read(file);})).toThrow();
  }
  expect(()=>readVenueBrowserStateSource(row.file,row.wrapper.replace('client/','other/'),read)).toThrow('exact state facade');
 }
});
it('restores only the two consumer imports and two added compatibility entries',()=>{
 expect(record.changes).toHaveLength(3);
 for(const row of record.changes){
  expect(sha(restoreVenueBrowserStateEdits(row.file,read(row.file)))).toBe(row.beforeSha);
  expect(sha(restoreVenueBrowserStateEdits(row.file,read(row.file)+'\nvoid changed();'))).not.toBe(row.beforeSha);
 }
});
it('reads both state and earlier pure modules from a child workspace directory',()=>{
 const stateModule=new URL('./venue-browser-state.mjs',import.meta.url).href;
 const leafModule=new URL('./venue-browser-leaves.mjs',import.meta.url).href;
 const leafFile='packages/venue-adapter/polymarket/submission/preflight/pmBuyOrderShares.ts';
 const program='import {readAdapterHistory} from '+JSON.stringify(new URL("./browser-entry-history.mjs",import.meta.url).href)+';import {readVenueBrowserStateSource} from '+JSON.stringify(stateModule)+';import {readVenueBrowserLeafSource} from '+JSON.stringify(leafModule)+';'+
  record.rows.map(row=>'readVenueBrowserStateSource('+JSON.stringify(row.file)+',readAdapterHistory(new URL('+JSON.stringify(new URL('../../'+row.file,import.meta.url).href)+'),"utf8"));').join('')+
  'readVenueBrowserLeafSource('+JSON.stringify(leafFile)+',readAdapterHistory(new URL('+JSON.stringify(new URL('../../'+leafFile,import.meta.url).href)+'),"utf8"));';
 expect(()=>execFileSync(process.execPath,['--input-type=module','--eval',program],{cwd:fileURLToPath(new URL('../../packages/venue-adapter',import.meta.url)),windowsHide:true})).not.toThrow();
});
