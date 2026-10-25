import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
import {sourceFixture} from './fixtures/source-fixture.mjs';
import { restoreVenueBrowserExecution } from "./venue-browser-execution.mjs";
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import ts from 'typescript';
import {expect,it} from 'vitest';
import {VENUE_BROWSER_LIFECYCLE as record,restoreVenueBrowserLifecycle,verifyVenueBrowserLifecycle} from './venue-browser-lifecycle.mjs';
import {verifyVenueBrowserRelocation} from './venue-browser-relocation.mjs';
const read=sourceFixture(withAdapterHistoryReader(f=>readAdapterHistory(f,'utf8').replaceAll('\r\n','\n')));
const after=f=>restoreVenueBrowserExecution(f,read(f));
const root='client/packages/venue-browser/';
const moved=record.changes.filter(row=>/^export \* from "@changmen\/venue-browser\//.test(after(row.file)));
const canonical=row=>root+after(row.file).match(/@changmen\/venue-browser\/([^"]+)/)[1]+'.ts';
const withoutImportTargets=source=>{
 const sf=ts.createSourceFile('source.ts',source,ts.ScriptTarget.Latest,true),edits=[];
 for(const node of sf.statements)if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier)edits.push([node.moduleSpecifier.getStart(sf),node.moduleSpecifier.end]);
 for(const [start,end] of edits.reverse())source=source.slice(0,start)+'"dependency"'+source.slice(end);
 return source;
};
it('moves all 18 complete modules with only module specifiers changed',()=>{
 expect(verifyVenueBrowserLifecycle(read)).toEqual({changedFiles:26,modules:19});expect(moved).toHaveLength(18);
 for(const row of moved)expect(withoutImportTargets(read(canonical(row))),row.file)
  .toBe(withoutImportTargets(restoreVenueBrowserLifecycle(row.file,read(row.file))));
});
it('extracts the complete live quote guard state and preserves the original host operations',()=>{
 const file='packages/venue-adapter/polymarket/quotes/pmTokenQuote.ts';
 const original=restoreVenueBrowserLifecycle(file,read(file)),marker='const lastLiveQuoteTs = new Map<string, number>();';
 expect(read(root+'polymarket/liveQuoteState.ts')).toBe(original.slice(original.indexOf(marker)));
 expect(after(file).slice(0,original.indexOf(marker))).toBe(original.slice(0,original.indexOf(marker)));
});
it('keeps all existing consumer statements except dependency specifiers and adds only one lock edge',()=>{
 for(const row of record.changes.filter(row=>row.file.endsWith('.ts')&&!moved.includes(row)&&!row.file.endsWith('/pmTokenQuote.ts')))
  expect(withoutImportTargets(after(row.file)),row.file).toBe(withoutImportTargets(restoreVenueBrowserLifecycle(row.file,read(row.file))));
 const lock=JSON.parse(after('package-lock.json')),prior=JSON.parse(restoreVenueBrowserLifecycle('package-lock.json',read('package-lock.json')));
 expect(lock.packages['client/packages/venue-browser'].dependencies['@changmen/client-core']).toBe('file:../client-core');
 delete lock.packages['client/packages/venue-browser'].dependencies['@changmen/client-core'];expect(lock).toEqual(prior);
});
it('rejects missing or modified sources and metadata through the existing complete gate',()=>{
 for(const row of [...record.changes,...record.added]){
  expect(()=>verifyVenueBrowserRelocation(f=>read(f)+(f===row.file?'\nvoid changed();\n':''))).toThrow();
  expect(()=>verifyVenueBrowserRelocation(f=>{if(f===row.file)throw Error('missing');return read(f);})).toThrow();
 }
},30_000);
