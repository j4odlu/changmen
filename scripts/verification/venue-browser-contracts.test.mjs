import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {expect,it} from 'vitest';
import {VENUE_BROWSER_CONTRACTS as record,restoreVenueBrowserContracts,restoreVenueBrowserContractImports,verifyVenueBrowserContracts} from './venue-browser-contracts.mjs';
import {verifyPmExecutionShadowContract} from './pm-execution-shadow-boundary.mjs';
import {restoreVenueBrowserPricing} from './venue-browser-pricing.mjs';
const read=file=>fs.readFileSync(file,'utf8').replaceAll('\r\n','\n');
const original=file=>execFileSync('git',['show',record.baseline+':'+file],{encoding:'utf8',windowsHide:true}).replaceAll('\r\n','\n');
const sha=s=>createHash('sha256').update(s).digest('hex');
it('preserves each complete host implementation and exact extracted declaration',()=>{
 expect(verifyVenueBrowserContracts(read)).toEqual({entries:3});
 for(const row of record.rows){
  expect(restoreVenueBrowserContracts(row.file,read(row.file),read)).toBe(original(row.file));
  expect(read(row.canonical)).toBe(row.prefix+row.fragment);
 }
});
it('rejects missing or changed canonical declarations and additional host behavior',()=>{
 for(const row of record.rows){
  for(const target of [row.file,row.canonical]){
   expect(()=>verifyVenueBrowserContracts(file=>read(file)+(file===target?'\nvoid altered();\n':''))).toThrow();
   expect(()=>verifyVenueBrowserContracts(file=>{if(file===target)throw Error('missing');return read(file);})).toThrow();
  }
  expect(()=>verifyVenueBrowserContracts(file=>file===row.file?read(file).replace('@changmen/venue-browser/','@changmen/missing/'):read(file))).toThrow();
 }
});
it('preserves the emitted preflight runtime exactly after the type-only extraction',()=>{
 const file='packages/venue-adapter/polymarket/fok/preflight.ts';
 const emit=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,removeComments:true}}).outputText;
 expect(emit(restoreVenueBrowserPricing(file,read(file)))).toBe(emit(original(file)));
 const typeFile=record.rows.find(row=>row.file===file).canonical;
 expect(emit(read(typeFile)).trim()).toBe('export {};');
});
it('does not hide changes outside the five registered consumer imports',()=>{
 expect(record.changes.flatMap(row=>row.replacements)).toHaveLength(5);
 for(const row of record.changes){
  expect(sha(restoreVenueBrowserContractImports(row.file,read(row.file)))).toBe(row.beforeSha);
  expect(sha(restoreVenueBrowserContractImports(row.file,read(row.file)+'\nvoid altered();'))).not.toBe(row.beforeSha);
 }
 expect(restoreVenueBrowserContracts('other.ts','unchanged();')).toBe('unchanged();');
});
it('the extracted predicate and error module have no host dependencies',()=>{
 for(const row of record.rows){
  const imports=ts.preProcessFile(read(row.canonical),true,true);
  expect(imports.importedFiles.map(row=>row.fileName)).toEqual(row.prefix?['./pmTickPrice']:[]);
 }
});
it('reads extracted declarations independently of the invoking workspace directory',()=>{
 const module=new URL('./venue-browser-contracts.mjs',import.meta.url).href;
 const file='packages/venue-adapter/polymarket/fok/preflight.ts';
 const source=new URL('../../'+file,import.meta.url).href;
 const code='import fs from "node:fs";import {restoreVenueBrowserContracts} from '+JSON.stringify(module)+';restoreVenueBrowserContracts('+JSON.stringify(file)+',fs.readFileSync(new URL('+JSON.stringify(source)+'),"utf8"));';
 expect(()=>execFileSync(process.execPath,['--input-type=module','--eval',code],{cwd:fileURLToPath(new URL('../../packages/venue-adapter',import.meta.url)),windowsHide:true})).not.toThrow();
});
it('the existing full-source verification entry also rejects a changed extracted type',()=>{
 expect(()=>verifyPmExecutionShadowContract(read)).not.toThrow();
 const file='client/packages/venue-browser/polymarket/pmOrderOptions.ts';
 expect(()=>verifyPmExecutionShadowContract(name=>name===file?read(name).replace('version: 2 | 3','version: 3'):read(name))).toThrow('complete extracted declaration');
});
