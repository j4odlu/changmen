import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
import { restoreVenueBrowserExecution } from "./venue-browser-execution.mjs";
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
import {expect,it} from 'vitest';
import {VENUE_BROWSER_METADATA as record,restoreVenueBrowserMetadataCache,verifyVenueBrowserMetadataCache} from './venue-browser-metadata.mjs';
import {verifyVenueBrowserRelocation} from './venue-browser-relocation.mjs';
const read=withAdapterHistoryReader(f=>readAdapterHistory(f,'utf8').replaceAll('\r\n','\n'));
const after=f=>restoreVenueBrowserExecution(f,read(f));
const source='packages/venue-adapter/polymarket/quotes/pmTickMetadata.ts';
const cache='client/packages/venue-browser/polymarket/pmTickMetadata.ts';
const parse=text=>ts.createSourceFile('metadata.ts',text,ts.ScriptTarget.Latest,true);
it('retains all original cache state, listeners, request queue and cleanup statements exactly',()=>{
 expect(verifyVenueBrowserMetadataCache(read)).toEqual({changedFiles:5,modules:1});
 const original=execFileSync('git',['show',record.baseline+':'+source],{encoding:'utf8',windowsHide:true}).replaceAll('\r\n','\n');
 const sf=parse(original),fetch=sf.statements.find(s=>s.name?.text==='fetchPmTickBufferTickSize').getText(sf);
 expect(read(cache).replace('"./pmTickState"','"../pmTickState"').replace('"./pmTickPrice"','"../pmTickPrice"'))
  .toBe(original.replace(fetch+'\n',''));
 const host=parse(after(source));
 expect(host.statements.find(s=>s.name?.text==='fetchPmTickBufferTickSize').getText(host)).toBe(fetch);
 expect(host.statements.filter(s=>!ts.isImportDeclaration(s)&&!ts.isExportDeclaration(s))).toHaveLength(1);
 expect(ts.preProcessFile(read(cache),true,true).importedFiles.map(row=>row.fileName)).toEqual(['./pmTickState','./pmTickPrice']);
});
it('preserves all host consumer behavior outside imports',()=>{
 const body=text=>{const sf=parse(text);return sf.statements.filter(s=>!ts.isImportDeclaration(s)&&!ts.isExportDeclaration(s)).map(s=>s.getFullText(sf)).join('');};
 for(const row of record.changes.filter(row=>row.file.endsWith('.ts')&&row.file!==source))
  expect(body(after(row.file)),row.file).toBe(body(restoreVenueBrowserMetadataCache(row.file,read(row.file))));
});
it('rejects missing or altered cache, HTTP implementation and consumer imports through the existing gate',()=>{
 for(const row of [...record.changes,...record.added]){
  expect(()=>verifyVenueBrowserRelocation(f=>read(f)+(f===row.file?'\nvoid changed();\n':''))).toThrow();
  expect(()=>verifyVenueBrowserRelocation(f=>{if(f===row.file)throw Error('missing');return read(f);})).toThrow();
 }
});
