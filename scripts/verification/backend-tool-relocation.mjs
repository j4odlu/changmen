// [changmen 扩展] Server tool ownership with an exact historical read view; no runtime resolver.
import assert from 'node:assert/strict';
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {restoreBackendProbeMetadata} from './backend-probe-relocation.mjs';
import {restoreNodeResourceMetadata} from './node-resource-isolation.mjs';
import {withRetiredNodeEntries} from './node-entry-retirement.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const normalize=s=>s.replaceAll('\r\n','\n');
export const backendToolSha=s=>createHash('sha256').update(normalize(s)).digest('hex');
const text=fs.readFileSync(new URL('./backend-tool-relocation.json',import.meta.url),'utf8');
assert.equal(backendToolSha(text),'ba8a61fd2d03d465ddc6f66d5610049cafe7e9ca6aba38b17c64b7ac38195ea6','Reviewed backend tool migration must not drift');
export const BACKEND_TOOL_RELOCATION=JSON.parse(text);
const record=BACKEND_TOOL_RELOCATION;
assert.equal(record.purpose,'backend-tool-relocation-only');
assert.equal(record.publishScopeOptimizationEnabled,false);
export const backendToolHistoryFiles=[record.source.file,...record.changes.map(row=>row.file),record.lock.file];
const known=new Set(backendToolHistoryFiles);
const relative=file=>typeof file==='string'&&known.has(file)?file:path.relative(root,file instanceof URL?fileURLToPath(file):path.resolve(file)).replaceAll('\\','/');
export function previousBackendTool(source){
 source=restoreNodeResourceMetadata(record.source.canonical,source);
 assert.equal(backendToolSha(source),record.source.afterSha,'Complete server bundle implementation must remain reviewed');
 let original=normalize(source);
 for(const replacement of [...record.source.replacements].reverse()){
  assert(original.includes(replacement.after));original=original.replace(replacement.after,replacement.before);
 }
 assert.equal(backendToolSha(original),record.source.beforeSha,'Entire original bundle implementation must restore');
 return original;
}
export function restoreBackendToolMetadata(file,source){
 source=restoreBackendProbeMetadata(file,source);
 const key=relative(file);
 if(key===record.source.file&&normalize(source)===record.source.wrapper)
  return previousBackendTool(fs.readFileSync(path.join(root,record.source.canonical),'utf8'));
 const row=record.changes.find(row=>row.file===key);
 if(row&&backendToolSha(source)===row.afterSha){assert.equal(backendToolSha(row.before),row.beforeSha);return row.before;}
 if(key!==record.lock.file||backendToolSha(source)!==record.lock.afterSha)return source;
 const lock=JSON.parse(source);
 for(const entry of record.lock.entries){
  assert.deepEqual(lock.packages[entry.key]??null,entry.after);
  if(entry.before===null)delete lock.packages[entry.key];else lock.packages[entry.key]=entry.before;
 }
 lock.packages=Object.fromEntries(record.lock.beforeOrder.map(key=>[key,lock.packages[key]]));
 const restored=JSON.stringify(lock,null,2)+'\n';
 assert.equal(backendToolSha(restored),record.lock.beforeSha,'Entire previous lock must restore, including every SDK integrity');
 return restored;
}
export function verifyBackendToolRelocation(read){
 const currentRead=withRetiredNodeEntries(read);read=file=>restoreBackendProbeMetadata(file,currentRead(file));
 assert.equal(normalize(read(record.source.file)),record.source.wrapper,'Old bundle entry must be an exact CLI/module delegate');
 previousBackendTool(read(record.source.canonical));
 for(const row of record.changes)assert.equal(backendToolSha(read(row.file)),row.afterSha,row.file+': complete reviewed backend tool metadata');
 assert.equal(backendToolSha(read(record.lock.file)),record.lock.afterSha,'Complete relocated backend lock');
 restoreBackendToolMetadata(record.lock.file,read(record.lock.file));
 const workspaces=JSON.parse(read('package.json')).workspaces;
 assert(workspaces.includes('server/packages/venue-adapter-tools'));
 assert(!workspaces.includes('packages/venue-adapter/scripts'));
 const tool=JSON.parse(read('server/packages/venue-adapter-tools/package.json'));
 assert.equal(tool.name,'@changmen/venue-adapter-tools');
 assert.deepEqual(tool.dependencies,{'@changmen/shared':'file:../../../packages/shared','@changmen/storage':'file:../../storage'});
 assert.deepEqual(tool.exports,{'./sync-backend-bundle.mjs':'./sync-backend-bundle.mjs'});
 assert.deepEqual(tool.files,['sync-backend-bundle.mjs']);
 assert.deepEqual(tool.scripts,{'sync:backend-bundle':'node sync-backend-bundle.mjs'});
 const lock=JSON.parse(read(record.lock.file));
 assert.deepEqual(lock.packages['server/packages/venue-adapter-tools'].dependencies,tool.dependencies);
 assert.equal(lock.packages['node_modules/@changmen/venue-adapter-tools'].resolved,'server/packages/venue-adapter-tools');
 assert.equal(lock.packages['packages/venue-adapter/scripts'],undefined);
 return {implementations:1,serverWorkspace:'server/packages/venue-adapter-tools',publishScopeOptimizationEnabled:false};
}
export function inspectBackendToolRelocation(base){
 const realBase=fs.realpathSync(base);
 return verifyBackendToolRelocation(file=>{
  const target=fs.realpathSync(path.join(realBase,file)),rel=path.relative(realBase,target);
  assert(rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel),'Backend migration escapes workspace');
  return fs.readFileSync(target,'utf8');
 });
}
