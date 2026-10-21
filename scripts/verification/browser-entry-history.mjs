// [changmen 扩展] Historical source view for exact-source checks only. No runtime resolver or filesystem patch.
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {backendToolHistoryFiles,restoreBackendToolMetadata} from './backend-tool-relocation.mjs';
import {backendProbeHistoryFiles,readPreviousBackendProbe,backendProbeCanonicalFile} from './backend-probe-relocation.mjs';
import {nodeResourceHistoryFiles} from './node-resource-isolation.mjs';
import {nodeEntryHistoryFiles,previousRetiredNodeEntry,retiredNodeCanonicalFile} from './node-entry-retirement.mjs';
import {catalogEnvironmentHistoryFiles} from './catalog-environment-isolation.mjs';
import {rdsRetirementHistoryFiles} from './rds-entry-retirement.mjs';
import {adminIsolationHistoryFiles} from './admin-maintenance-isolation.mjs';
import {rdsLegacyHistoryFiles,previousRdsLegacyEntry} from './rds-legacy-relocation.mjs';
import {restoreRayA8PrecheckSource} from './ray-a8-precheck-boundary.mjs';
import {restore9999CProbabilitySource} from './single-leg-9999-c-probability-boundary.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
export const browserHistorySha=s=>createHash('sha256').update(s.replaceAll('\r\n','\n')).digest('hex');
const text=fs.readFileSync(new URL('./browser-entry-retirement.json',import.meta.url),'utf8');
// Reviewed inventory hash is inserted after generation.
assert.equal(browserHistorySha(text),"27dbd70b51c005df7c2d6d6669cd895f0c72f5f73eea0513c7802da7ece658b1",'Browser retirement inventory changed');
export const BROWSER_ENTRY_RETIREMENT=JSON.parse(text);
assert.equal(BROWSER_ENTRY_RETIREMENT.retired.length,595);
assert.equal(BROWSER_ENTRY_RETIREMENT.baseline,'c3bf0ac3e20d5221dfc36a79fc3a01f5487af9e1');
const previous=JSON.parse(fs.readFileSync(new URL('./adapter-browser-relocation.json',import.meta.url),'utf8'));
assert.equal(browserHistorySha(fs.readFileSync(new URL('./adapter-browser-relocation.json',import.meta.url),'utf8')),'a114f11ce18799965f900333f01ac6b55d9a0cbc065b6bfba729ff67f431b00d');
const entries=new Map(previous.records.map(row=>[row.file,row]));
assert.deepEqual(BROWSER_ENTRY_RETIREMENT.retired,[...entries.keys()]);
const known=new Set([...entries.keys(),...previous.records.map(row=>row.canonical),...BROWSER_ENTRY_RETIREMENT.changes.map(row=>row.file),...backendToolHistoryFiles,...backendProbeHistoryFiles,...nodeResourceHistoryFiles,...nodeEntryHistoryFiles,...catalogEnvironmentHistoryFiles,...rdsRetirementHistoryFiles,...adminIsolationHistoryFiles,...rdsLegacyHistoryFiles]);
const relative=file=>typeof file==='string'&&known.has(file)?file:path.relative(root,file instanceof URL?fileURLToPath(file):path.resolve(file)).replaceAll('\\','/');
export function restoreBrowserEntryRetirement(file,source){
 source=restoreRayA8PrecheckSource(relative(file),restore9999CProbabilitySource(relative(file),source));
 const key=typeof file==='string'&&entries.has(file)?file:relative(file);
 for(const row of [...BROWSER_ENTRY_RETIREMENT.changes].reverse())if(row.file===key&&browserHistorySha(source)===row.afterSha){
  assert.equal(browserHistorySha(row.before),row.beforeSha,'Previous consumer snapshot changed: '+key);source=row.before;
 }
 return source;
}
export function withAdapterHistoryReader(read){
 return file=>{
  let source;
  try{source=read(file);}catch(error){
   if(error.code==='ENOENT'){const retired=previousRetiredNodeEntry(relative(file),read);if(retired!==undefined)return retired;}
   if(error.code==='ENOENT'){const legacy=previousRdsLegacyEntry(relative(file),read);if(legacy!==undefined)return legacy;}
   if(error.code==='ENOENT'){const probe=readPreviousBackendProbe(relative(file),read);if(probe!==undefined)return probe;}
   const row=entries.get(relative(file));if(error.code!=='ENOENT'||!row)throw error;
   const canonical=restoreBrowserEntryRetirement(row.canonical,read(row.canonical));
   assert.equal(browserHistorySha(canonical),row.afterSha,row.canonical+': retired entry still requires the complete real implementation');
   return row.wrapper;
  }
  return restoreBrowserEntryRetirement(file,restoreBackendToolMetadata(file,source));
 };
}
export function readAdapterHistory(file,options){
 const source=withAdapterHistoryReader(target=>fs.readFileSync(adapterHistoryDependencyFile(typeof target==='string'&&known.has(target)?path.join(root,target):target),options??'utf8'))(file);
 return options===undefined?Buffer.from(source):source;
}
// A historical resolver can return a virtual old dependency path. Direct reads must
// use the same workspace owner as resolver probes; root-hoisted paths stay intact.
export function adapterHistoryDependencyFile(file){
 const key=relative(file),prefix='packages/venue-adapter/node_modules/';
 return key===prefix.slice(0,-1)?path.join(root,'client/packages/venue-browser/node_modules')
  :key.startsWith(prefix)?path.join(root,'client/packages/venue-browser/node_modules',key.slice(prefix.length)):file;
}
export function adapterHistorySystem(system){
 const directories=new Set();for(const file of entries.keys())for(let dir=path.posix.dirname(file);dir!=='.';dir=path.posix.dirname(dir))directories.add(dir);
 const dependency=adapterHistoryDependencyFile;
 return {...system,fileExists:file=>system.fileExists(dependency(file))||entries.has(relative(file)),
 directoryExists:dir=>Boolean(system.directoryExists?.(dependency(dir)))||directories.has(relative(dir)),readFile:file=>{
  try{return readAdapterHistory(dependency(file),'utf8');}catch(error){if(error.code==='ENOENT')return undefined;throw error;}
 }};
}
export function adapterCanonicalFile(file){return entries.get(relative(file))?.canonical??retiredNodeCanonicalFile(relative(file));}
