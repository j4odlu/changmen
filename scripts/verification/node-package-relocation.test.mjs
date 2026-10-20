import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { NODE_PACKAGE_RELOCATION as record, verifyNodePackageRelocation, readNodePackageSource, restoreNodePackageMetadata } from './node-package-relocation.mjs';
import { syncPlatformAdapterBackendBundle } from "../../server/venues/sync-backend-bundle.mjs";
import { isVersionSource } from '../../devtools/runtime-tooling/runtime_version.js';
import { classifyDeployScope } from '../deploy/classify-deploy-scope.mjs';
const read=withRetiredNodeEntries(file=>fs.readFileSync(file,'utf8').replaceAll('\r\n','\n'));
const original=file=>execFileSync('git',['show',`${record.baseline}:${file}`],{encoding:'utf8',windowsHide:true}).replaceAll('\r\n','\n');

it('restores every complete original Node implementation and metadata input',()=>{
 expect(verifyNodePackageRelocation(read).size).toBe(6);
 for(const row of record.sourceRows)expect(readNodePackageSource(row.file,read(row.file),read)).toBe(original(row.file));
 for(const row of record.changes)expect(restoreNodePackageMetadata(row.file,read(row.file))).toBe(original(row.file));
});
it.each(record.sourceRows)('rejects redirected or missing source at $file',row=>{
 for(const file of [row.file,row.canonical]){
  expect(()=>verifyNodePackageRelocation(f=>f===file?read(f)+'\nvoid unexpected();':read(f))).toThrow();
  expect(()=>verifyNodePackageRelocation(f=>{if(f===file)throw Error('missing');return read(f);})).toThrow();
 }
});
it('rejects drift between the public Node catalog export and the shared source',()=>{
 expect(()=>verifyNodePackageRelocation(file=>file==='server/packages/venue-node-registry/manifest.json'?'[]':read(file))).toThrow();
});
it('keeps all canonical runtime files in both conservative version fingerprints',()=>{
 for(const row of record.sourceRows){
  for(const role of ['frontend','backend'])expect(isVersionSource(row.canonical,role)).toBe(true);
  expect(classifyDeployScope([row.canonical])).toBe(classifyDeployScope([row.file]));
 }
});
it('canonical and public package entry points share functions, cache reset and registry state',()=>{
 const result=execFileSync(process.execPath,['--import','./scripts/testing/offline-env.mjs','--input-type=module','-e',`
 import assert from 'node:assert/strict';
  import * as current from './server/venues/loader/adapter_paths.mjs';
 import * as pkg from '@changmen/venue-node';
  import * as paths from '@changmen/venue-node/registry/paths.js';
 import * as feeds from '@changmen/venue-node/registry/feeds.js';
 import manifest from '@changmen/venue-node/registry/manifest.json' with {type:'json'};
 import legacyManifest from './packages/venue-adapter/registry/manifest.json' with {type:'json'};
 for(const key of Object.keys(current)){assert.equal(pkg[key],current[key]);assert.equal(pkg[key],current[key]);}
 assert.equal(current.getRegistryPaths().getPlatformNodeRoot,paths.getPlatformNodeRoot);
 assert.equal(current.adapterRequire('registry','paths.js').MANIFEST,paths.MANIFEST);
 assert.equal(feeds.MANIFEST,paths.MANIFEST);
 assert.equal(manifest,paths.MANIFEST);assert.deepEqual(manifest,legacyManifest);
 assert.equal(current.requirePlatform('OB','node','session.js'),pkg.requirePlatform('OB','backend','session.js'));
 const before=current.getAdapterRoot();
 paths.setPlatformNodeRootForTests('/explicit-probe-override');
 assert.equal(paths.getPlatformNodeRoot(),'/explicit-probe-override');
 current.resetAdapterRootForTests();
 assert.notEqual(paths.getPlatformNodeRoot(),'/explicit-probe-override');
 await current.initAdapterRegistry();await current.initEsmPlatformBackends();
 assert.equal(pkg.getAdapterRoot(),before);
 for(const key of ['CHANGMEN_ADAPTER_ROOT','GAMEBET_ADAPTER_ROOT']){
  process.env[key]=before;pkg.resetAdapterRootForTests();assert.equal(current.getAdapterRoot(),before);delete process.env[key];
 }
 const probes=paths.getPlatformNodeRoot();
 for(const key of ['CHANGMEN_PLATFORM_PROBES_ROOT','GAMEBET_PLATFORM_PROBES_ROOT','CHANGMEN_NODE_ROOT','GAMEBET_NODE_ROOT']){
  process.env[key]=probes;paths.resetPlatformNodeRootForTests();assert.equal(paths.getPlatformNodeRoot(),probes);delete process.env[key];
 }
 process.env.CHANGMEN_ADAPTER_ROOT='/missing-relocation-fixture';pkg.resetAdapterRootForTests();
 assert.throws(()=>current.getAdapterRoot(),/CHANGMEN_ADAPTER_ROOT invalid/);
 console.log('identity-and-cache: OK');
 `],{encoding:'utf8',windowsHide:true,timeout:25000});
 expect(result).toContain('identity-and-cache: OK');
},30000);
it('materializes standalone legacy implementations in the slim artifact without changing the source tree',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'changmen-node-bundle-'));
 try{
  const dst=syncPlatformAdapterBackendBundle({dst:path.join(temp,'platform_adapter')});
  for(const row of record.sourceRows){
   const relative=row.file.slice('packages/venue-adapter/'.length);
   expect(read(path.join(dst,relative))).toBe(original(row.file));
   expect(read(row.file)).toBe(row.wrapper);
  }
  expect(read(path.join(dst,'registry/manifest.json'))).toBe(read('packages/venue-adapter/registry/manifest.json'));
  expect(fs.existsSync(path.join(dst,'ob/collect.ts'))).toBe(false);
  const custom=path.join(temp,'custom');
  fs.mkdirSync(path.join(custom,'registry'),{recursive:true});
  fs.writeFileSync(path.join(custom,'registry/manifest.json'),'{}');
  expect(()=>syncPlatformAdapterBackendBundle({src:custom,dst:path.join(temp,'custom-output')})).not.toThrow();
 }finally{
  if(path.dirname(path.resolve(temp))!==path.resolve(os.tmpdir())||!path.basename(temp).startsWith('changmen-node-bundle-'))throw Error('unsafe cleanup');
  fs.rmSync(temp,{recursive:true,force:true});
 }
});

it('runs the slim artifact with no workspace sources or inherited package links',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'changmen-node-runtime-'));
 try{
  const backend=path.join(temp,'server/backend');
  fs.mkdirSync(backend,{recursive:true});
  fs.writeFileSync(path.join(backend,'package.json'),JSON.stringify({name:'@changmen/backend',type:'module'}));
  // Copy the real storage package, not a link back into the checkout.
  const storage=path.join(temp,'node_modules/@changmen/storage');
  fs.mkdirSync(storage,{recursive:true});
  for(const entry of fs.readdirSync('server/storage')){
   if(entry.endsWith('.js')||entry==='package.json')fs.copyFileSync(path.join('server/storage',entry),path.join(storage,entry));
  }
  const dst=syncPlatformAdapterBackendBundle({dst:path.join(backend,'platform_adapter')});
  // Deterministic offline platform fixture exercises real preload/cache behavior.
  const ob=path.join(backend,'platform_node/ob');
  fs.mkdirSync(ob,{recursive:true});
  fs.writeFileSync(path.join(ob,'package.json'),'{"type":"module"}');
  fs.writeFileSync(path.join(ob,'session.js'),'export const sentinel = {};');
  const entry=pathToFileURL(path.join(dst,'loader/adapter_paths.mjs')).href;
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|COMSPEC)$/i.test(key)));
  env.CHANGMEN_STORAGE_DIR=path.join(temp,'storage');
  const result=execFileSync(process.execPath,['--input-type=module','-e',`
   import assert from 'node:assert/strict';
   import fs from 'node:fs';
   import path from 'node:path';
   import net from 'node:net';
   const blocked=()=>{throw Error('network forbidden');};net.Socket.prototype.connect=blocked;globalThis.fetch=blocked;
   const api=await import(${JSON.stringify(entry)});
   assert.equal(api.getAdapterRoot(),path.join(process.cwd(),'server/backend/platform_adapter'));
   assert.equal(api.getRegistryPaths().getPlatformNodeRoot(),path.join(process.cwd(),'server/backend/platform_node'));
   const platform=api.requirePlatform('OB','node','session.js');
   assert.equal(platform,api.requirePlatform('ob','backend','session.js'));
   assert.equal(typeof api.adapterRequire('registry','feeds.js').listPlatforms,'function');
   api.resetAdapterRootForTests();await api.initAdapterRegistry();await api.initEsmPlatformBackends();
   assert.equal(api.requirePlatform('OB','node','session.js'),platform);
   for(const directory of ['packages','server/packages','devtools'])assert.equal(fs.existsSync(directory),false);
   console.log('isolated-slim-runtime: OK');
  `],{cwd:temp,env,encoding:'utf8',windowsHide:true,timeout:15000});
  expect(result).toContain('isolated-slim-runtime: OK');
 }finally{
  if(path.dirname(path.resolve(temp))!==path.resolve(os.tmpdir())||!path.basename(temp).startsWith('changmen-node-runtime-'))throw Error('unsafe cleanup');
  fs.rmSync(temp,{recursive:true,force:true});
 }
});

import {withRetiredNodeEntries} from './node-entry-retirement.mjs';
