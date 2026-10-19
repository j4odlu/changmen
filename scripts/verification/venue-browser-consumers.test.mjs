import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
import {expect,it} from 'vitest';
import {VENUE_BROWSER_CONSUMERS as record,restoreVenueBrowserConsumers,verifyVenueBrowserConsumers} from './venue-browser-consumers.mjs';
import {verifyVenueBrowserRelocation} from './venue-browser-relocation.mjs';
import {restoreVenueBrowserLifecycle} from './venue-browser-lifecycle.mjs';
const read=f=>fs.readFileSync(f,'utf8').replaceAll('\r\n','\n');
const sha=s=>createHash('sha256').update(s).digest('hex');
const original=f=>execFileSync('git',['show',record.baseline+':'+f],{encoding:'utf8',windowsHide:true}).replaceAll('\r\n','\n');
it('retains every previous consumer and rejects changes through the complete boundary gate',()=>{
 expect(verifyVenueBrowserConsumers(read)).toEqual({changedFiles:10,workers:1});
 for(const row of record.changes)expect(sha(restoreVenueBrowserConsumers(row.file,read(row.file)))).toBe(row.beforeSha);
 for(const row of [...record.changes,...record.added]){
  expect(()=>verifyVenueBrowserRelocation(f=>read(f)+(f===row.file?'\nvoid changed();\n':''))).toThrow();
  expect(()=>verifyVenueBrowserRelocation(f=>{if(f===row.file)throw Error('missing');return read(f);})).toThrow();
 }
});
it('preserves Worker startup exactly and consumer statements after imports are removed',()=>{
 const worker=record.added[0].file;
 expect(read(worker).replace('"./workerDiagnostics"','"../browser/pm-book-diagnostics/workerDiagnostics"'))
  .toBe(original('packages/venue-adapter/polymarket/marketData.worker.ts'));
 const file='client/web/src/runtime/pmDynamicWsShadowWorker.ts';
 const body=source=>{
  const parsed=ts.createSourceFile('consumer.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  return parsed.statements.filter(stmt=>!ts.isImportDeclaration(stmt)).map(stmt=>stmt.getFullText(parsed)).join('');
 };
 expect(body(read(file))).toBe(body(original(file)));
});
it('declares the direct browser dependency and removes the two obsolete deep-import exceptions',()=>{
 expect(JSON.parse(read('client/web/package.json')).dependencies['@changmen/venue-browser']).toBe('file:../packages/venue-browser');
 const checker=read('client/devtools/venue-adapter/list-web-venue-imports.mjs');
 expect(checker).not.toContain('"runtime/pmDynamicWsShadowWorker.ts"');
 expect(checker).not.toContain('"runtime/pmDynamicWsShadowWorker.test.ts"');
 const lock=JSON.parse(restoreVenueBrowserLifecycle('package-lock.json',read('package-lock.json'))),previous=JSON.parse(restoreVenueBrowserConsumers('package-lock.json',read('package-lock.json')));
 expect(Object.keys(lock.packages)).toEqual(Object.keys(previous.packages));
 for(const [file,value] of Object.entries(previous.packages))if(file!=='client/web')expect(lock.packages[file],file).toEqual(value);
});
