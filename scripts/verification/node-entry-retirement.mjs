// [changmen 扩展] Retired source exists only in historical verification views, never runtime.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {componentImportSites} from './component-entry-boundary.mjs';
import {sourceOwnershipInventory} from './source-ownership.mjs';
import {restoreCatalogEnvironmentMetadata} from './catalog-environment-isolation.mjs';
import {retiredManifestHistoryFiles,previousRetiredPackageManifest,inspectPublishRetirementMetadata} from './publish-retirement-metadata.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const normalize=s=>s.replaceAll('\r\n','\n');
export const nodeEntrySha=s=>createHash('sha256').update(normalize(s)).digest('hex');
const text=fs.readFileSync(new URL('./node-entry-retirement.json',import.meta.url),'utf8');
assert.equal(nodeEntrySha(text),'252c9f189c1e4f7efc901be972e56886a56bb9eb98daeb6d4e985a2e41e525c6');
export const NODE_ENTRY_RETIREMENT=JSON.parse(text);
assert.equal(NODE_ENTRY_RETIREMENT.purpose,'retire-unused-node-entries-only');
assert.equal(NODE_ENTRY_RETIREMENT.publishScopeOptimizationEnabled,false);
const removed=new Map(NODE_ENTRY_RETIREMENT.removed.map(row=>[row.file,row]));
export const retiredNodeCanonicalFile=file=>removed.get(file)?.canonical??file;
export const nodeEntryHistoryFiles=[...removed.keys(),...NODE_ENTRY_RETIREMENT.changes.map(row=>row.file),...retiredManifestHistoryFiles];
const known=new Set(nodeEntryHistoryFiles);
const relative=file=>typeof file==='string'&&known.has(file)?file:path.relative(root,file instanceof URL?fileURLToPath(file):path.resolve(file)).replaceAll('\\','/');
export function restoreRetiredNodeMetadata(file,source){
 source=restoreCatalogEnvironmentMetadata(file,source);
 const key=relative(file);
 for(const row of [...NODE_ENTRY_RETIREMENT.changes].reverse())if(row.file===key&&nodeEntrySha(source)===row.afterSha){assert.equal(nodeEntrySha(row.before),row.beforeSha);source=row.before;}
 return source;
}
export function previousRetiredNodeEntry(file,read){
 const row=removed.get(relative(file));if(!row)return previousRetiredPackageManifest(file,read);
 const actual=nodeEntrySha(read(row.canonical));
 assert([row.canonicalSha,row.historicalCanonicalSha].includes(actual),row.canonical+': exact retained implementation');
 assert.equal(nodeEntrySha(row.before),row.beforeSha,'Retired entry snapshot changed');return row.before;
}
export function withRetiredNodeEntries(read){
 return file=>{let source;try{source=read(file);}catch(error){if(error.code!=='ENOENT')throw error;
  source=previousRetiredNodeEntry(file,read);if(source===undefined)throw error;}
  return restoreRetiredNodeMetadata(file,source);
 };
}
export function inspectNodeEntryRetirement(base){
 base=fs.realpathSync(base);
 inspectPublishRetirementMetadata(base);
 const read=file=>{const target=fs.realpathSync(path.join(base,file)),rel=path.relative(base,target);
  assert(rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel),'Retirement evidence escaped repository');return fs.readFileSync(target,'utf8');};
 for(const row of removed.values()){
  assert(!fs.lstatSync(path.join(base,row.file),{throwIfNoEntry:false}),row.file+': retired Node entry returned');
  assert.equal(nodeEntrySha(read(row.canonical)),row.canonicalSha,row.canonical+': implementation changed');
 }
 for(const row of NODE_ENTRY_RETIREMENT.changes)assert.equal(nodeEntrySha(restoreCatalogEnvironmentMetadata(row.file,read(row.file))),row.afterSha,row.file+': reviewed entry retirement changed');
 assert.deepEqual(JSON.parse(read('packages/venue-adapter/package.json')).exports,{},'Old adapter must expose no runtime modules');
 let runtimeFiles=0;
 function walk(dir){for(const item of fs.readdirSync(path.join(base,dir),{withFileTypes:true})){
  if(item.name.startsWith('.')||item.isSymbolicLink()||['node_modules','dist','coverage','platform_adapter','platform_node'].includes(item.name)||dir==='server/backend'&&item.name==='storage')continue;
  const file=dir+'/'+item.name;if(item.isDirectory()){walk(file);continue;}if(!/\.[cm]?[jt]sx?$/.test(file))continue;
  runtimeFiles++;
  for(const site of componentImportSites(file,read(file))){if(!site.spec)continue;
   const target=site.spec.startsWith('.')?path.posix.normalize(path.posix.join(path.posix.dirname(file),site.spec)):'';
   assert(!removed.has(target)&&!/^@changmen\/venue-adapter(?:\/|$)/.test(site.spec),file+': imports retired Node entry');
  }
 }}
 for(const dir of ['server','client','chrome-extension','packages','devtools'])walk(dir);
 const outside=sourceOwnershipInventory(base).files.filter(row=>row.layer==='backend'&&!row.file.startsWith('server/'));
 assert.deepEqual(outside,[],'Backend implementation or entry remains outside server/');
 return {retired:removed.size,runtimeFiles,backendEntriesOutsideServer:outside.length};
}
