// [changmen 扩展] Exact Node package relocation; preserve original source and metadata proofs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { restoreVenueManifestMetadata } from './venue-manifest-metadata.mjs';
import { restoreBackendToolMetadata } from './backend-tool-relocation.mjs';
import { restoreNodeResourceMetadata } from './node-resource-isolation.mjs';
import {withRetiredNodeEntries} from './node-entry-retirement.mjs';
const normalize=s=>s.replaceAll('\r\n','\n');
const sha=s=>createHash('sha256').update(normalize(s)).digest('hex');
const text=fs.readFileSync(new URL('./node-package-relocation.json',import.meta.url),'utf8');
assert.equal(sha(text),'a9fa4ab15891ab7dadfebf06a427b5f81af52bc4b48ef6d81f03260355e395a6');
export const NODE_PACKAGE_RELOCATION=JSON.parse(text);
const entries=new Map(NODE_PACKAGE_RELOCATION.sourceRows.map(row=>[row.file,row]));
export const nodeCanonicalPath=file=>entries.get(file)?.canonical??file;
export function restoreNodePackageMetadata(file,source){
 source=restoreBackendToolMetadata(file,source);
 source=restoreVenueManifestMetadata(file,source);
 source=normalize(source);
 const row=NODE_PACKAGE_RELOCATION.changes.find(row=>row.file===file);
 if(!row||sha(source)!==row.afterSha)return source;
 const lines=source.split('\n');
 for(const patch of [...row.patches].reverse()){
  const start=patch.newCount===0?patch.newStart:patch.newStart-1;
  assert.deepEqual(lines.slice(start,start+patch.newCount),patch.after);
  lines.splice(start,patch.newCount,...patch.before);
 }
 const restored=lines.join('\n');assert.equal(sha(restored),row.beforeSha,`${file}: previous complete metadata`);return restored;
}
export function readNodePackageSource(file,source,read){
 const row=entries.get(file);
 if(!row||normalize(source)!==row.wrapper)return source;
 const current=normalize(restoreNodeResourceMetadata(row.canonical,read(row.canonical)));
 assert.equal(sha(current),row.canonicalSha,`${row.canonical}: entire Node implementation`);
 const restored=current.replaceAll(`new URL("../../../${file}", import.meta.url)`,'import.meta.url');
 assert.equal(sha(restored),row.sourceSha,`${file}: original complete implementation`);
 return restored;
}
export function verifyNodePackageRelocation(read){
 read=withRetiredNodeEntries(read);
 const certified=new Set();
 for(const row of entries.values()){
  assert.equal(normalize(read(row.file)),row.wrapper,`${row.file}: exact Node facade`);
  readNodePackageSource(row.file,read(row.file),read);
  certified.add(row.file);certified.add(row.canonical);
 }
 assert.equal(normalize(read('server/packages/venue-node-registry/manifest.json')),normalize(read('packages/venue-adapter/registry/manifest.json')),'Generated Node and legacy catalog exports must match');
 const root=JSON.parse(read('package.json'));
 for(const name of ['loader','registry']){
  assert(root.workspaces.includes(`server/packages/venue-node-${name}`));
  assert(!root.workspaces.includes(`packages/venue-adapter/${name}`));
  const old=JSON.parse(read(`packages/venue-adapter/${name}/package.json`));
  const current=JSON.parse(restoreNodeResourceMetadata(`server/packages/venue-node-${name}/package.json`,read(`server/packages/venue-node-${name}/package.json`)));
  assert.equal(current.name,old.name);assert.deepEqual(current.exports,old.exports);assert.deepEqual(current.files,old.files);
  for(const target of Object.values(current.exports))read(`server/packages/venue-node-${name}/${target.slice(2)}`);
 }
 return certified;
}
export function inspectNodePackageRelocation(root){
 const read=file=>{
  const absolute=fs.realpathSync(path.join(root,file)),relative=path.relative(fs.realpathSync(root),absolute);
  assert(relative!=='..'&&!relative.startsWith(`..${path.sep}`)&&!path.isAbsolute(relative));
  return fs.readFileSync(absolute,'utf8');
 };
 return {entries:verifyNodePackageRelocation(read).size/2};
}
