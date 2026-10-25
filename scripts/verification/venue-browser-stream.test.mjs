import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
import {sourceFixture} from './fixtures/source-fixture.mjs';
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
import {expect,it} from 'vitest';
import {VENUE_BROWSER_STREAM as record,verifyVenueBrowserStream,restoreVenueBrowserStream} from './venue-browser-stream.mjs';
import {verifyVenueBrowserRelocation} from './venue-browser-relocation.mjs';
import {restoreVenueBrowserLifecycle} from './venue-browser-lifecycle.mjs';
const read=sourceFixture(withAdapterHistoryReader(file=>readAdapterHistory(file,'utf8').replaceAll('\r\n','\n')));
const original=file=>execFileSync('git',['show',record.baseline+':'+file],{encoding:'utf8',windowsHide:true}).replaceAll('\r\n','\n');
it('moves the complete stream implementation with only its type import changed',()=>{
 expect(verifyVenueBrowserStream(read)).toEqual({changedFiles:6,implementations:1});
 expect(read(record.added[0].file).replace('"@changmen/pm-market-data-browser/marketStreamProtocol"','"./marketStreamProtocol"'))
  .toBe(original('packages/venue-adapter/polymarket/realtime/marketStream.ts'));
});
it('keeps every producer and host statement outside imports identical',()=>{
 const body=text=>{const parsed=ts.createSourceFile('host.ts',text,ts.ScriptTarget.Latest,true);return parsed.statements.filter(s=>!ts.isImportDeclaration(s)).map(s=>s.getFullText(parsed)).join('');};
 for(const row of record.changes.filter(row=>row.file.endsWith('.ts')&&!row.file.endsWith('/marketStream.ts')))
  expect(body(restoreVenueBrowserLifecycle(row.file,read(row.file)))).toBe(body(restoreVenueBrowserStream(row.file,read(row.file))));
});
it('rejects changed or missing source, facade, consumers and metadata through the existing complete gate',()=>{
 for(const row of [...record.changes,...record.added]){
  expect(()=>verifyVenueBrowserRelocation(file=>read(file)+(file===row.file?'\nvoid changed();\n':''))).toThrow();
  expect(()=>verifyVenueBrowserRelocation(file=>{if(file===row.file)throw Error('missing');return read(file);})).toThrow();
 }
});
