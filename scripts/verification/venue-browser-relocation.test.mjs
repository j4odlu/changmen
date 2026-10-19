import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {expect,it} from 'vitest';
import {VENUE_BROWSER_RELOCATION as record,restoreVenueBrowserSource,restoreVenueBrowserMetadata,verifyVenueBrowserRelocation} from './venue-browser-relocation.mjs';
import {declaredInstallClosure,readInstallWorkspaces} from './component-install-inputs.mjs';
import {installedPmDependency,pmNodeBrowserLoaderTarget} from './pm-dependency-audit.mjs';
import {classifySourceFile,sourceLayerViolation} from './source-ownership.mjs';
import {isVersionSource} from '../../devtools/runtime-tooling/runtime_version.js';
import {classifyDeployScope} from '../deploy/classify-deploy-scope.mjs';
import {restoreVenueBrowserWorkspace} from './venue-browser-workspace.mjs';
const read=file=>fs.readFileSync(file,'utf8').replaceAll('\r\n','\n');
const original=file=>execFileSync('git',['show',record.baseline+':'+file],{encoding:'utf8',windowsHide:true}).replaceAll('\r\n','\n');
it('retains the full original implementation after reversing only relative imports',()=>{
 expect(verifyVenueBrowserRelocation(read).entries).toBe(10);
 const frozen=JSON.parse(read('packages/venue-adapter/esport-freeze.json')).paths;
 const protectedFiles=JSON.parse(read('scripts/verification/vps-fok-baseline.json')).protectedFiles;
 for(const row of record.rows){
  expect(frozen).not.toContain(row.file);expect(protectedFiles[row.file]).toBeUndefined();
  expect(restoreVenueBrowserSource(row,read(row.canonical))).toBe(original(row.file));
 }
});
it('rejects missing, changed or redirected sources and extra facade implementation',()=>{
 for(const row of record.rows){
  expect(()=>verifyVenueBrowserRelocation(file=>file===row.canonical?read(file)+'\nvoid unexpected();\n':read(file))).toThrow();
  expect(()=>verifyVenueBrowserRelocation(file=>{if(file===row.canonical)throw Error('missing');return read(file);})).toThrow();
  expect(()=>verifyVenueBrowserRelocation(file=>file===row.file?read(file).replace('from "','from "missing/'):read(file))).toThrow();
  expect(()=>verifyVenueBrowserRelocation(file=>file===row.file?read(file)+'export const duplicate = true;\n':read(file))).toThrow();
 }
});
it('restores only the two exact metadata edits for existing complete-source proofs',()=>{
 expect(record.changes.map(row=>row.file)).toEqual(['scripts/verification/source-ownership-inputs.json','scripts/deploy/component-inputs.json']);
 for(const row of record.changes){
  expect(restoreVenueBrowserMetadata(row.file,read(row.file))).toBe(original(row.file));
  expect(restoreVenueBrowserMetadata(row.file,read(row.file)+'\n')).not.toBe(original(row.file));
 }
});
it('owns browser sources in their independent workspace while retaining earlier metadata proofs',()=>{
 expect(fs.existsSync('client/packages/venue-browser/package.json')).toBe(true);
 const root=process.cwd(),packages=readInstallWorkspaces(root);
 expect([...packages.keys()]).toContain('@changmen/venue-browser');
 const frontend=declaredInstallClosure(root,packages,'@changmen/web',{build:true});
 expect(frontend.sourceDirectories).toEqual(frontend.workspaceDirectories);
 expect(frontend.workspaceDirectories).toContain('client/packages/venue-browser');
 for(const name of ['@changmen/backend','@changmen/db']){
  const closure=declaredInstallClosure(root,packages,name);
  expect(closure.sourceDirectories).not.toContain('client/packages/venue-browser');
 }
 const fact=installedPmDependency(root,'client/packages/venue-browser/pm-book-diagnostics/bookRuntime.ts','@changmen/pm-market-data-browser/bookReducer');
 expect(fact.owner).toBe('client/packages/venue-browser/package.json');expect(fact.declaredRuntime).toBe(true);
 for(const file of ['package.json','package-lock.json','packages/venue-adapter/package.json'])expect(restoreVenueBrowserWorkspace(file,read(file))).toBe(original(file));
});
it('classifies the new sources as browser-only and preserves conservative publication',()=>{
 const policy=JSON.parse(read('scripts/verification/source-ownership-inputs.json'));
 for(const row of record.rows){
  expect(classifySourceFile(row.canonical,policy)?.layer).toBe('frontend');
  expect(sourceLayerViolation('server/backend/server.js',row.canonical,policy)).toBeTruthy();
  expect(sourceLayerViolation(row.canonical,'server/db/index.js',policy)).toBeTruthy();
  expect(isVersionSource(row.canonical,'frontend')).toBe(true);expect(isVersionSource(row.canonical,'backend')).toBe(true);
  expect(classifyDeployScope([row.canonical])).toBe('full');
 }
 expect(pmNodeBrowserLoaderTarget({environment:'node',kind:'custom-loader',loaderSymbol:'adapterRequire',arguments:['..','..','client/packages/venue-browser/pm-book-source.ts']})).toBeTruthy();
});
