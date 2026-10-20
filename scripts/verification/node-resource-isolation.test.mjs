// [changmen 扩展] Exercise server resources, actual legacy-root denial and packaging contracts.
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';import os from 'node:os';import path from 'node:path';import{execFileSync}from'node:child_process';import{expect,it}from'vitest';
import{NODE_RESOURCE_ISOLATION as record,verifyNodeResourceIsolation}from'./node-resource-isolation.mjs';
import{syncPlatformAdapterBackendBundle}from"../../server/venues/sync-backend-bundle.mjs";
const read=file=>fs.readFileSync(file,'utf8');
it('owns the runtime assets in the existing registry workspace and keeps the generated catalog exact',()=>{
 expect(verifyNodeResourceIsolation(read).oldAdapterRequired).toBe(false);
 expect(JSON.parse(read('server/packages/venue-node-registry/package.json')).files).toContain('runtime');
 expect(()=>verifyNodeResourceIsolation(f=>f===record.runtime+'/registry/manifest.json'?'[]':read(f))).toThrow('only authored source');
});
it.each([...new Set(record.changes.map(r=>r.file)),...record.assets.map(r=>r.file),record.lock.file])('rejects unreviewed or missing resource inputs: %s',file=>{
 expect(()=>verifyNodeResourceIsolation(f=>read(f)+(f===file?'\nchanged':''))).toThrow();
 expect(()=>verifyNodeResourceIsolation(f=>{if(f===file)throw Error('missing input');return read(f);})).toThrow();
});
it('loads registry state and creates an artifact with every old adapter filesystem access forbidden',()=>{
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|COMSPEC)$/i.test(key)));
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'changmen-server-resources-'));
 try{
  const dst=path.join(root,'artifact');
  const result=execFileSync(process.execPath,['--import','./scripts/testing/offline-env.mjs','--input-type=module','-e',`
   import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import net from 'node:net';
   const old=path.join(process.cwd(),'packages/venue-adapter');let oldAccesses=0;
   for(const name of ['readFileSync','readdirSync','statSync','lstatSync','existsSync']){const original=fs[name];fs[name]=function(file,...args){const key=file instanceof URL?file.pathname:String(file);if(key.replaceAll('\\\\','/').includes('/packages/venue-adapter/')){oldAccesses++;throw Error('old adapter resource access forbidden');}return original.call(this,file,...args);};}
   net.Socket.prototype.connect=()=>{throw Error('network forbidden')};globalThis.fetch=()=>{throw Error('network forbidden')};
   const loader=await import('@changmen/venue-node');const registry=await import('@changmen/venue-node/registry/paths.js');
   assert.equal(loader.getAdapterRoot(),path.join(process.cwd(),${JSON.stringify("server/venues/registry/runtime")}));
   assert.equal(loader.getRegistryPaths().MANIFEST,registry.MANIFEST);assert.equal(loader.getRegistryPaths().getPlatformNodeRoot,registry.getPlatformNodeRoot);
   const tool=await import('@changmen/venue-node/sync-backend-bundle.mjs');tool.syncPlatformAdapterBackendBundle({dst:${JSON.stringify(dst)}});
   assert.equal(oldAccesses,0);console.log('no legacy filesystem access: OK');
  `],{env,encoding:'utf8',windowsHide:true,timeout:20000});
  expect(result).toContain('no legacy filesystem access: OK');
  for(const [output,input]of [['loader/adapter_paths.mjs','server/packages/venue-node-loader/adapter_paths.mjs'],['registry/paths.js','server/packages/venue-node-registry/paths.js'],['registry/feeds.js','server/packages/venue-node-registry/feeds.js']])expect(read(path.join(dst,output))).toBe(read(input));
  expect(read(path.join(dst,'registry/manifest.json'))).toBe(read('packages/shared/catalog/venue_manifest.json'));
  expect(fs.existsSync(path.join(dst,'node_modules'))).toBe(false);
 }finally{const real=fs.realpathSync(root);expect(path.dirname(real)).toBe(fs.realpathSync(os.tmpdir()));expect(path.basename(real)).toMatch(/^changmen-server-resources-/);fs.rmSync(real,{recursive:true,force:true});}
},30000);
it('preserves explicit external catalogs and browser opt-in, and fails before replacing a valid artifact',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'changmen-resource-options-'));
 const write=(file,text)=>{const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,text);};
 try{
  const src=path.join(root,'source'),dst=path.join(root,'artifact');
  write('source/registry/manifest.json','[{"id":"EXTERNAL"}]');write('source/shared/fixture.js','export const kept = true;');write('source/ob/collect.ts','export const browser = true;');
  syncPlatformAdapterBackendBundle({src,dst});expect(read(path.join(dst,'registry/manifest.json'))).toBe('[{"id":"EXTERNAL"}]');expect(fs.existsSync(path.join(dst,'shared/fixture.js'))).toBe(true);expect(fs.existsSync(path.join(dst,'ob/collect.ts'))).toBe(false);
  syncPlatformAdapterBackendBundle({src,dst,includeBrowserSources:true});expect(read(path.join(dst,'ob/collect.ts'))).toContain('browser');
  fs.unlinkSync(path.join(src,'registry/manifest.json'));expect(()=>syncPlatformAdapterBackendBundle({src,dst})).toThrow('source missing manifest');expect(fs.existsSync(path.join(dst,'ob/collect.ts'))).toBe(true);
  write('source/registry/manifest.json','[]');for(const target of [src,path.join(src,'child'),root])expect(()=>syncPlatformAdapterBackendBundle({src,dst:target})).toThrow('must not overlap');expect(read(path.join(src,'registry/manifest.json'))).toBe('[]');
 }finally{const real=fs.realpathSync(root);expect(path.dirname(real)).toBe(fs.realpathSync(os.tmpdir()));expect(path.basename(real)).toMatch(/^changmen-resource-options-/);fs.rmSync(real,{recursive:true,force:true});}
});
