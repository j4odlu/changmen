// [changmen 扩展] Exact server relocation; historical views never participate in runtime loading.
import assert from 'node:assert/strict';
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {restoreNodeResourceMetadata} from './node-resource-isolation.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),norm=s=>s.replaceAll('\r\n','\n');
export const backendProbeSha=s=>createHash('sha256').update(norm(s)).digest('hex');
const text=fs.readFileSync(new URL('./backend-probe-relocation.json',import.meta.url),'utf8');
assert.equal(backendProbeSha(text),"1e6f1c7eaa8ee81cbcf682a32709437c1f61b22b8492cafe27222ecce57eaecd",'Reviewed backend probe relocation must not drift');
export const BACKEND_PROBE_RELOCATION=JSON.parse(text);
const record=BACKEND_PROBE_RELOCATION;
assert.equal(record.purpose,'backend-probe-relocation-only');assert.equal(record.publishScopeOptimizationEnabled,false);
assert.equal(record.moves.length,93);
export const backendProbeHistoryFiles=[...record.moves.flatMap(r=>[r.file,r.canonical]),...record.changes.map(r=>r.file),record.lock.file];
const known=new Set(backendProbeHistoryFiles),moves=new Map(record.moves.map(r=>[r.file,r]));
const relative=file=>typeof file==='string'&&known.has(file)?file:path.relative(root,file instanceof URL?fileURLToPath(file):path.resolve(file)).replaceAll('\\','/');
export const backendProbeCanonicalFile=file=>moves.get(relative(file))?.canonical??file;
export function readPreviousBackendProbe(file,read){
 const row=moves.get(relative(file));if(!row)return undefined;
 const source=restoreNodeResourceMetadata(row.canonical,read(row.canonical));assert.equal(backendProbeSha(source),row.afterSha,row.canonical+': complete relocated source required');
 const before=row.before??source;assert.equal(backendProbeSha(before),row.beforeSha,row.file+': entire original probe source');return before;
}
export function restoreBackendProbeMetadata(file,source){
 source=restoreNodeResourceMetadata(file,source);
 const key=relative(file);
 for(const row of [...record.changes].reverse())if(row.file===key&&backendProbeSha(source)===row.afterSha){assert.equal(backendProbeSha(row.before),row.beforeSha);source=row.before;}
 if(key!==record.lock.file||backendProbeSha(source)!==record.lock.afterSha)return source;
 const lock=JSON.parse(source);for(const row of record.lock.entries){assert.deepEqual(lock.packages[row.key]??null,row.after);if(row.before===null)delete lock.packages[row.key];else lock.packages[row.key]=row.before;}
 lock.packages=Object.fromEntries(record.lock.beforeOrder.map(key=>[key,lock.packages[key]]));
 const previous=JSON.stringify(lock,null,2)+'\n';assert.equal(backendProbeSha(previous),record.lock.beforeSha,'Every previous locked package must restore');return previous;
}
export function verifyBackendProbeRelocation(read,exists){
 const currentRead=read;read=file=>restoreNodeResourceMetadata(file,currentRead(file));
 for(const row of record.moves){
  assert(!exists(row.file),row.file+': retired probe source must not return');
  assert.equal(row.canonical,'server/platform-probes'+row.file.slice('devtools/platform-probes'.length));
  if(/\.md$/i.test(row.file))assert(exists(row.canonical),row.canonical+': relocated documentation missing');
  else readPreviousBackendProbe(row.file,read);
 }
 const final=new Map(record.changes.map(row=>[row.file,row]));
 for(const row of final.values())assert.equal(backendProbeSha(read(row.file)),row.afterSha,row.file+': exact reviewed probe consumer');
 assert.equal(backendProbeSha(read(record.lock.file)),record.lock.afterSha);restoreBackendProbeMetadata(record.lock.file,read(record.lock.file));
 const rootPackage=JSON.parse(read('package.json'));
 assert(rootPackage.workspaces.includes('server/platform-probes'));assert(!rootPackage.workspaces.includes('devtools/platform-probes'));
 const probes=JSON.parse(read('server/platform-probes/package.json'));
 assert.equal(probes.name,'@changmen/platform-probes');assert.deepEqual(probes.dependencies,{'@changmen/db':'file:../db','@changmen/storage':'file:../storage','@changmen/shared':'file:../../packages/shared'});
 const lock=JSON.parse(read(record.lock.file));assert.equal(lock.packages['node_modules/@changmen/platform-probes'].resolved,'server/platform-probes');
 return {files:record.moves.length,runtimeFiles:record.moves.filter(r=>/\.[cm]?[jt]s$/.test(r.canonical)).length,publishScopeOptimizationEnabled:false};
}
export function inspectBackendProbeRelocation(base){
 const real=fs.realpathSync(base),read=file=>{const target=fs.realpathSync(path.join(real,file)),rel=path.relative(real,target);assert(rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel),'Probe relocation escapes workspace');return fs.readFileSync(target,'utf8');};
 const expected=new Set(record.moves.map(row=>row.canonical));
 function scan(directory,legacy){
  if(!fs.existsSync(path.join(real,directory)))return;
  for(const item of fs.readdirSync(path.join(real,directory),{withFileTypes:true})){
   if(['node_modules','dist','coverage'].includes(item.name)||item.name.startsWith('.'))continue;
   const file=directory+'/'+item.name;
   if(item.isDirectory())scan(file,legacy);
   else if(/\.[cm]?[jt]sx?$/.test(item.name))assert(!legacy&&expected.has(file),file+': unreviewed probe implementation or old source returned');
  }
 }
 scan('devtools/platform-probes',true);scan('server/platform-probes',false);
 return verifyBackendProbeRelocation(read,file=>Boolean(fs.lstatSync(path.join(real,file),{throwIfNoEntry:false})));
}
