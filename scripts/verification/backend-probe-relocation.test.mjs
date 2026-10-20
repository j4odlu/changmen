// [changmen 扩展] Real physical ownership, CLI forwarding, preload identity and slim artifact regressions.
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import {restoreCatalogEnvironmentMetadata} from './catalog-environment-isolation.mjs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {expect,it} from 'vitest';
import {BACKEND_PROBE_RELOCATION as record,verifyBackendProbeRelocation,backendProbeSha,readPreviousBackendProbe,restoreBackendProbeMetadata} from './backend-probe-relocation.mjs';
import {readAdapterHistory} from './browser-entry-history.mjs';
import {isVersionSource} from '../../devtools/runtime-tooling/runtime_version.js';
import {classifyDeployScope} from '../deploy/classify-deploy-scope.mjs';
const read=file=>fs.readFileSync(file,'utf8'),exists=file=>fs.existsSync(file);
const runtime=record.moves.filter(row=>/\.[cm]?[jt]s$/.test(row.file));
it('retires all 93 old files and retains every complete runtime byte at its single server location',()=>{
 expect(verifyBackendProbeRelocation(read,exists).runtimeFiles).toBe(63);
 for(const row of runtime){const previous=restoreCatalogEnvironmentMetadata(row.canonical,read(row.canonical));expect(backendProbeSha(previous)).toBe(row.beforeSha);expect(readAdapterHistory(row.file,'utf8')).toBe(previous);}
 const pkg=JSON.parse(read('server/platform-probes/package.json'));
 expect(pkg.scripts).toEqual(JSON.parse(readPreviousBackendProbe('devtools/platform-probes/package.json',read)).scripts);
 expect(backendProbeSha(restoreBackendProbeMetadata(record.lock.file,read(record.lock.file)))).toBe(record.lock.beforeSha);
});
it.each(runtime)('rejects changed or missing canonical source: $canonical',row=>{
 for(const reader of [f=>read(f)+(f===row.canonical?'\nvoid unexpected();':''),f=>{if(f===row.canonical)throw Error('missing implementation');return read(f);}])expect(()=>verifyBackendProbeRelocation(reader,exists)).toThrow();
 expect(()=>verifyBackendProbeRelocation(read,file=>file===row.file||exists(file))).toThrow('retired probe source must not return');
});
it('preserves backend publication and version coverage without adding frontend source ownership',()=>{
 for(const row of runtime){expect(isVersionSource(row.canonical,'backend')).toBe(true);expect(isVersionSource(row.canonical,'frontend')).toBe(false);expect(classifyDeployScope([row.canonical])).toBe('backend');}
});
it('loads the same platform modules through the package and Node loader, including overrides and reset',()=>{
 const output=execFileSync(process.execPath,['--import','./scripts/testing/offline-env.mjs','--input-type=module','-e',`
 import assert from 'node:assert/strict';import path from 'node:path';import net from 'node:net';
 let attempts=0;const blocked=()=>{attempts++;throw Error('network forbidden')};net.Socket.prototype.connect=blocked;globalThis.fetch=blocked;
 const loader=await import('@changmen/venue-node');
 const probes=path.join(process.cwd(),'server/platform-probes');assert.equal(loader.getRegistryPaths().getPlatformNodeRoot(),probes);
 for(const id of ['OB','PB','RAY']){const module=await import('@changmen/platform-probes/'+id.toLowerCase()+'/session.js');assert.equal(loader.requirePlatform(id,'node','session.js'),module);assert.equal(loader.requirePlatform(id,'backend','session.js'),module);}
 for(const key of ['CHANGMEN_PLATFORM_PROBES_ROOT','GAMEBET_PLATFORM_PROBES_ROOT','CHANGMEN_NODE_ROOT','GAMEBET_NODE_ROOT']){process.env[key]=probes;loader.resetAdapterRootForTests();await loader.initAdapterRegistry();await loader.initEsmPlatformBackends();assert.equal(loader.getRegistryPaths().getPlatformNodeRoot(),probes);delete process.env[key];}
 loader.resetAdapterRootForTests();await loader.initAdapterRegistry();await loader.initEsmPlatformBackends();assert.equal(loader.getRegistryPaths().getPlatformNodeRoot(),probes);assert.equal(attempts,0);console.log('server-probes: OK');
 `],{encoding:'utf8',windowsHide:true,timeout:20000});
 expect(output).toContain('server-probes: OK');
},30000);
it('runs the real CLI from another cwd and forwards platform arguments exactly',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'changmen-probe-cli-'));
 try{
  const scripts=path.join(root,'scripts'),platform=path.join(root,'ob/scripts');fs.mkdirSync(scripts,{recursive:true});fs.mkdirSync(platform,{recursive:true});
  fs.copyFileSync('server/platform-probes/scripts/platform-cli.mjs',path.join(scripts,'platform-cli.mjs'));
  fs.writeFileSync(path.join(platform,'fixture.cjs'),'console.log(JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2)}));');
  const result=JSON.parse(execFileSync(process.execPath,[path.join(scripts,'platform-cli.mjs'),'ob','fixture.cjs','--','one','--flag','two'],{cwd:os.tmpdir(),encoding:'utf8',windowsHide:true,timeout:10000}));
  expect(result).toEqual({cwd:root,args:['one','--flag','two']});
 }finally{const real=fs.realpathSync(root);expect(path.dirname(real)).toBe(fs.realpathSync(os.tmpdir()));expect(path.basename(real)).toMatch(/^changmen-probe-cli-/);fs.rmSync(real,{recursive:true,force:true});}
});
it('copies the original Node artifact from the new default root without browser sources',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'changmen-probe-bundle-'));
 try{
  const dst=path.join(root,'platform_node');
  execFileSync(process.execPath,['--import','./scripts/testing/offline-env.mjs','--input-type=module','-e',`import {syncPlatformNodeBundle} from './server/platform-probes/scripts/sync-backend-bundle.mjs';syncPlatformNodeBundle({dst:${JSON.stringify(dst)}});`],{encoding:'utf8',windowsHide:true,timeout:15000});
  for(const row of runtime)expect(read(path.join(dst,row.canonical.slice('server/platform-probes/'.length)))).toBe(read(row.canonical));
  expect(exists(path.join(dst,'node_modules'))).toBe(false);expect(exists(path.join(dst,'client'))).toBe(false);
 }finally{const real=fs.realpathSync(root);expect(path.dirname(real)).toBe(fs.realpathSync(os.tmpdir()));expect(path.basename(real)).toMatch(/^changmen-probe-bundle-/);fs.rmSync(real,{recursive:true,force:true});}
},30000);
