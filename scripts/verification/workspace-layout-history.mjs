// Explicit pre-migration source view for historical proofs only. Never installed
// as a Node loader and never patches the process filesystem or module resolver.
import native from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire as nativeRequire} from 'node:module';
import assert from 'node:assert/strict';
import {restoreBackendCommandPaths} from './backend-command-paths.mjs';
import {frontendDependencyFiles,restoreFrontendDependencySource} from './frontend-dependency-refactor.mjs';
import {ACCOUNT_EDIT_EXTRACTION,restoreAccountEditSource} from './account-edit-extraction.mjs';
import {pendingVenueFixFiles} from './pending-venue-fixes.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const sha=s=>createHash('sha256').update(s.replaceAll('\r\n','\n')).digest('hex');
const recordFile=new URL('./workspace-layout-relocation.json',import.meta.url);
const text=native.readFileSync(recordFile,'utf8');
assert.equal(sha(text),'7ff22ea5dbeca54f235b0fc6910c7bd3e795084bea72a20818e9b7a184a3340b');
export const WORKSPACE_LAYOUT_RELOCATION=JSON.parse(text);
assert.equal(WORKSPACE_LAYOUT_RELOCATION.baseline,'8758b45701b9f80472155df40435f75931683dbd');
assert.equal(WORKSPACE_LAYOUT_RELOCATION.purpose,'root-rds-and-workspace-consolidation');
const rows=new Map(WORKSPACE_LAYOUT_RELOCATION.files.map(row=>[row.file,row]));
const reverse=new Map([...rows.values()].filter(row=>row.canonical).map(row=>[row.canonical,row.file]));
export function restoreWorkspaceLayoutSource(file,source){
 source=restoreBackendCommandPaths(file,restoreFrontendDependencySource(file,source));
 const row=rows.get(file)??rows.get(reverse.get(file));
 if(row?.canonical&&sha(source)===row.afterSha){assert.equal(sha(row.before),row.beforeSha);return row.before;}
 return source;
}
const key=file=>path.relative(root,file instanceof URL?fileURLToPath(file):path.resolve(file)).replaceAll('\\','/');
export function currentWorkspaceFile(file){return rows.get(file)?.canonical??file;}
const directories=new Map();
for(const row of rows.values())for(let f=row.file,d=path.posix.dirname(f);d!=='.';f=d,d=path.posix.dirname(d)){
 if(!directories.has(d))directories.set(d,new Set());directories.get(d).add(path.posix.basename(f));
}
function actual(row){
 if(!row.canonical)return undefined;
 const target=path.join(root,row.canonical),real=native.realpathSync(target),rel=path.relative(root,real);
 assert(rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel),'Historical proof target escapes repository');
 return restoreBackendCommandPaths(row.canonical,restoreFrontendDependencySource(row.canonical,native.readFileSync(real,'utf8')));
}
export function readPreviousWorkspaceFile(file,options){
 const row=rows.get(key(file));
 if(!row){
  const source=native.readFileSync(file,options);
  if(!frontendDependencyFiles.has(key(file))&&key(file)!==ACCOUNT_EDIT_EXTRACTION.file&&!pendingVenueFixFiles.has(key(file)))return source;
  const restored=restoreFrontendDependencySource(key(file),restoreAccountEditSource(key(file),source.toString()));
  return Buffer.isBuffer(source)?Buffer.from(restored):restored;
 }
 if(row.canonical){const source=actual(row);if(sha(source)!==row.afterSha)return typeof options==='string'||options?.encoding?source:Buffer.from(source);}
 else assert(!native.existsSync(path.join(root,row.file)),row.file+': retired source returned');
 assert.equal(sha(row.before),row.beforeSha,'Historical source snapshot changed');
 return typeof options==='string'||options?.encoding?row.before:Buffer.from(row.before);
}
function mapped(file){const row=rows.get(key(file));return row?.canonical?path.join(root,row.canonical):file;}
function isVirtual(file){const k=key(file);return rows.has(k)||directories.has(k);}
function historicalRealpath(file,options){
 if(isVirtual(file)){
  const row=rows.get(key(file));if(row?.canonical)actual(row);
  return options==='buffer'||options?.encoding==='buffer'?Buffer.from(path.resolve(file)):path.resolve(file);
 }
 return native.realpathSync(file,options);
}
export const historicalWorkspaceFs={...native,
 readFileSync:readPreviousWorkspaceFile,
 existsSync:file=>isVirtual(file)||native.existsSync(file),
 realpathSync:historicalRealpath,
 statSync:(file,...args)=>{
  const row=rows.get(key(file));if(row?.canonical)return native.statSync(mapped(file),...args);
  if(isVirtual(file))return native.statSync(root,...args);
  return native.statSync(file,...args);
 },
 lstatSync:(file,...args)=>{
  const row=rows.get(key(file));if(row?.canonical)return native.lstatSync(mapped(file),...args);
  if(isVirtual(file))return native.lstatSync(root,...args);
  return native.lstatSync(file,...args);
 },
 readdirSync:(dir,options)=>{
  const extra=directories.get(key(dir));if(!extra)return native.readdirSync(dir,options);
  const names=new Set(native.existsSync(dir)?native.readdirSync(dir):[]);for(const name of extra)names.add(name);
  return [...names].sort().map(name=>{
   if(!options?.withFileTypes)return name;
   const full=path.join(dir,name),isDirectory=directories.has(key(full));
   if(!isVirtual(full))return native.readdirSync(dir,{withFileTypes:true}).find(row=>row.name===name);
   return{name,isDirectory:()=>isDirectory,isFile:()=>!isDirectory,isSymbolicLink:()=>false};
  });
 },
};
export function historicalCreateRequire(file){
 const logical=file instanceof URL?fileURLToPath(file):file;
 const require=nativeRequire(mapped(logical));
 const resolve=(spec,options)=>{
  if(/^@changmen\/match-identity(?:\/|$)/.test(spec))return path.join(root,'server/match/identity',spec==='@changmen/match-identity'?'index.js':spec.slice('@changmen/match-identity/'.length));
  if(spec.startsWith('.')){
   const target=path.resolve(path.dirname(logical),spec);
   for(const suffix of ['', '.js','.mjs','.json','/index.js'])if(rows.has(key(target+suffix)))return target+suffix;
  }
  const next=spec.replace(/^@changmen\/venue-node-registry\//,'@changmen/venue-node/registry/')
   .replace(/^@changmen\/venue-node-loader(?=\/|$)/,'@changmen/venue-node')
   .replace(/^@changmen\/venue-adapter-tools(?=\/|$)/,'@changmen/venue-node')
   .replace(/^@changmen\/match-identity(?=\/|$)/,'@changmen/shared/match-identity');
  const resolved=require.resolve(next,options),prior=reverse.get(key(resolved));return prior?path.join(root,prior):resolved;
 };
 const call=spec=>require(spec);call.resolve=resolve;return call;
}
