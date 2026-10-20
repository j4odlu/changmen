// [changmen 扩展] A real server-owned resource root; exact historical views are verification-only.
import assert from 'node:assert/strict';import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';import path from 'node:path';import{fileURLToPath}from'node:url';import{createHash}from'node:crypto';
const root=fileURLToPath(new URL('../../',import.meta.url)),norm=s=>s.replaceAll('\r\n','\n');
import {restoreRetiredNodeMetadata} from './node-entry-retirement.mjs';
export const nodeResourceSha=s=>createHash('sha256').update(norm(s)).digest('hex');
const text=fs.readFileSync(new URL('./node-resource-isolation.json',import.meta.url),'utf8');
assert.equal(nodeResourceSha(text),"f80807b3a5487c50a569b78a908157a87672aa44f84354df02dd6f1217f66bba",'Reviewed resource migration must not drift');
export const NODE_RESOURCE_ISOLATION=JSON.parse(text);
const record=NODE_RESOURCE_ISOLATION;
assert.equal(record.purpose,'server-node-resource-isolation-only');assert.equal(record.publishScopeOptimizationEnabled,false);
export const nodeResourceHistoryFiles=[...record.changes.map(row=>row.file),record.lock.file];
const known=new Set(nodeResourceHistoryFiles),relative=file=>typeof file==='string'&&known.has(file)?file:path.relative(root,file instanceof URL?fileURLToPath(file):path.resolve(file)).replaceAll('\\','/');
export function restoreNodeResourceMetadata(file,source){
 source=restoreRetiredNodeMetadata(file,source);
 const key=relative(file);
 for(const row of [...record.changes].reverse())if(row.file===key&&nodeResourceSha(source)===row.afterSha){assert.equal(nodeResourceSha(row.before),row.beforeSha);source=row.before;}
 if(key!==record.lock.file||nodeResourceSha(source)!==record.lock.afterSha)return source;
 const lock=JSON.parse(source);assert.deepEqual(lock.packages[record.lock.key],record.lock.after);lock.packages[record.lock.key]=record.lock.before;
 const previous=JSON.stringify(lock,null,2)+'\n';assert.equal(nodeResourceSha(previous),record.lock.beforeSha,'Entire previous lock including every external dependency must restore');return previous;
}
export function verifyNodeResourceIsolation(read){
 const current=read;read=file=>restoreRetiredNodeMetadata(file,current(file));
 const final=new Map(record.changes.map(row=>[row.file,row]));
 for(const row of final.values())assert.equal(nodeResourceSha(read(row.file)),row.afterSha,row.file+': exact reviewed resource migration');
 for(const row of record.assets)assert.equal(nodeResourceSha(read(row.file)),row.sha256,row.file+': exact server resource entry');
 assert.equal(nodeResourceSha(read(record.lock.file)),record.lock.afterSha,'Complete resource-tool lock');restoreNodeResourceMetadata(record.lock.file,read(record.lock.file));
 const shared=read('packages/shared/catalog/venue_manifest.json');
 assert.equal(norm(read(record.runtime+'/registry/manifest.json')),norm(shared),'Node runtime manifest must match its only authored source');
 const registry=JSON.parse(read('server/packages/venue-node-registry/package.json'));
 assert(registry.files.includes('runtime'),'Node resources must ship with their owner workspace');
 const tool=JSON.parse(read('server/packages/venue-adapter-tools/package.json'));
 assert.equal(tool.dependencies['@changmen/venue-node-loader'],'file:../venue-node-loader');assert.equal(tool.dependencies['@changmen/venue-node-registry'],'file:../venue-node-registry');
 return {runtime:record.runtime,oldAdapterRequired:false,publishScopeOptimizationEnabled:false};
}
export function inspectNodeResourceIsolation(base){
 const real=fs.realpathSync(base);return verifyNodeResourceIsolation(file=>{const target=fs.realpathSync(path.join(real,file)),rel=path.relative(real,target);assert(rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel),'Resource migration escapes workspace');return fs.readFileSync(target,'utf8');});
}
