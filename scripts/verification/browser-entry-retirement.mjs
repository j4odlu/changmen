// [changmen 扩展] Check real files and imports; historical readers are never used for this boundary.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {BROWSER_ENTRY_RETIREMENT,browserHistorySha,restoreBrowserEntryRetirement} from './browser-entry-history.mjs';
import {componentImportSites} from './component-entry-boundary.mjs';
import {restoreBackendToolMetadata} from './backend-tool-relocation.mjs';
export function certifiedBrowserConsumerChanges(read){
 const first=new Map();for(const row of BROWSER_ENTRY_RETIREMENT.changes)if(!first.has(row.file))first.set(row.file,row);
 const certified=new Set();
 for(const row of first.values())if(browserHistorySha(restoreBrowserEntryRetirement(row.file,read(row.file)))===row.beforeSha)certified.add(row.file);
 return certified;
}
export function verifyBrowserEntryRetirement(read,exists){
 const final=new Map(BROWSER_ENTRY_RETIREMENT.changes.map(row=>[row.file,row]));
 for(const row of BROWSER_ENTRY_RETIREMENT.changes)assert.equal(browserHistorySha(row.before),row.beforeSha,row.file+': original consumer snapshot');
 for(const file of BROWSER_ENTRY_RETIREMENT.retired)assert(!exists(file),file+': retired browser entry must not return');
 for(const row of final.values())assert.equal(browserHistorySha(restoreBackendToolMetadata(row.file,read(row.file))),row.afterSha,row.file+': complete reviewed consumer change');
 return {retired:BROWSER_ENTRY_RETIREMENT.retired.length,consumers:final.size};
}
export function inspectBrowserEntryRetirement(root){
 const base=fs.realpathSync(root),read=file=>{
  const target=fs.realpathSync(path.join(base,file)),rel=path.relative(base,target);
  assert(rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel),'Retirement evidence escapes workspace');
  return fs.readFileSync(target,'utf8');
 };
 const result=verifyBrowserEntryRetirement(read,file=>Boolean(fs.lstatSync(path.join(base,file),{throwIfNoEntry:false})));
 const retired=new Set(BROWSER_ENTRY_RETIREMENT.retired);
 function walk(dir){for(const item of fs.readdirSync(path.join(base,dir),{withFileTypes:true})){
  if(['node_modules','dist','coverage'].includes(item.name))continue;
  const file=dir+'/'+item.name;
  if(item.isDirectory()){walk(file);continue;}
  if(!/\.(?:[cm]?[jt]sx?|vue|html)$/.test(file))continue;
  for(const site of componentImportSites(file.endsWith('.html')?file+'.vue':file,read(file))){
   if(!site.spec)continue;
   assert(!/^@changmen\/venue-adapter(?:\/|$)/.test(site.spec),file+': client imports retired adapter package');
   if(site.spec.startsWith('.')){const target=path.posix.normalize(path.posix.join(path.posix.dirname(file),site.spec));
    assert(!target.startsWith('packages/venue-adapter/')&&!retired.has(target),file+': client imports retired physical file');
   }
  }
 }}
 walk('client/web');walk('client/packages');
 const web=JSON.parse(read('client/web/package.json'));
 for(const group of ['dependencies','devDependencies','optionalDependencies','peerDependencies'])assert(!web[group]?.['@changmen/venue-adapter'],'Web cannot reinstall the retired browser package');
 assert.deepEqual(JSON.parse(restoreBackendToolMetadata('packages/venue-adapter/package.json',read('packages/venue-adapter/package.json'))).exports,{
  './loader/adapter_paths.js':'./loader/adapter_paths.mjs','./loader/adapter_paths.mjs':'./loader/adapter_paths.mjs'
 });
 return result;
}
