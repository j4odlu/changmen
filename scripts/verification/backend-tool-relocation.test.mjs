// [changmen 扩展] Exercise both retained CLI/module identity and the actual relocated artifact.
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {expect,it} from 'vitest';
import {BACKEND_TOOL_RELOCATION as record,verifyBackendToolRelocation,previousBackendTool,restoreBackendToolMetadata,backendToolSha} from './backend-tool-relocation.mjs';
import {isVersionSource} from '../../devtools/runtime-tooling/runtime_version.js';
import {classifyDeployScope} from '../deploy/classify-deploy-scope.mjs';
import {restoreBackendProbeMetadata} from './backend-probe-relocation.mjs';
import * as canonical from "../../server/venues/sync-backend-bundle.mjs";
const read=withRetiredNodeEntries(file=>fs.readFileSync(file,'utf8'));
it('has exactly one server implementation and restores the complete previous tool and lock',()=>{
 expect(verifyBackendToolRelocation(read).implementations).toBe(1);
 expect(backendToolSha(previousBackendTool(read(record.source.canonical)))).toBe(record.source.beforeSha);
 expect(backendToolSha(restoreBackendToolMetadata(record.lock.file,read(record.lock.file)))).toBe(record.lock.beforeSha);
 const before=JSON.parse(restoreBackendToolMetadata(record.lock.file,read(record.lock.file)));
 const after=JSON.parse(restoreBackendProbeMetadata(record.lock.file,read(record.lock.file)));
 for(const key of Object.keys(before.packages))if(!record.lock.entries.some(row=>row.key===key))expect(after.packages[key]).toEqual(before.packages[key]);
});
it.each([record.source.file,record.source.canonical,...record.changes.map(row=>row.file),record.lock.file])('rejects modified or missing source: %s',file=>{
 expect(()=>verifyBackendToolRelocation(f=>read(f)+(f===file?'\nvoid unreviewed();':''))).toThrow();
 expect(()=>verifyBackendToolRelocation(f=>{if(f===file)throw Error('missing reviewed input');return read(f);})).toThrow();
});
it('retains conservative publication and both role fingerprints for the relocated source',()=>{
 for(const role of ['frontend','backend'])expect(isVersionSource(record.source.canonical,role)).toBe(true);
 expect(classifyDeployScope([record.source.canonical])).toBe('full');
});
it('materializes a runnable standalone tool without links to its workspace implementation',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'changmen-server-bundle-tool-'));
 const write=(file,source)=>{const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,source);};
 try{
  write('server/backend/package.json','{"name":"@changmen/backend","type":"module"}');
  for(const name of ['package.json','paths.js','changmen_root.js'])write('node_modules/@changmen/storage/'+name,read('server/storage/'+name));
  write('node_modules/@changmen/shared/package.json','{"name":"@changmen/shared","exports":{"./catalog/venue_manifest.json":"./catalog/venue_manifest.json"}}');
  write('node_modules/@changmen/shared/catalog/venue_manifest.json',read('packages/shared/catalog/venue_manifest.json'));
  const src=canonical.syncPlatformAdapterBackendBundle({dst:path.join(root,'server/backend/platform_adapter')});
  const packed=path.join(src,'scripts/sync-backend-bundle.mjs'),source=read(packed);
  expect(source).not.toContain('new URL("../../../packages/venue-adapter/scripts/sync-backend-bundle.mjs", import.meta.url)');
  expect(source).not.toMatch(/^export \* from ["']\.\.\/\.\.\/\.\.\/server\/packages\/venue-adapter-tools\//m);
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|COMSPEC)$/i.test(key)));
  env.CHANGMEN_STORAGE_DIR=path.join(root,'storage');
  const url=pathToFileURL(packed).href,dst=path.join(root,'repacked');
  const output=execFileSync(process.execPath,['--input-type=module','-e',`import assert from 'node:assert/strict';import fs from 'node:fs';import net from 'node:net';net.Socket.prototype.connect=()=>{throw Error('network forbidden')};globalThis.fetch=()=>{throw Error('network forbidden')};const api=await import(${JSON.stringify(url)});api.syncPlatformAdapterBackendBundle({dst:${JSON.stringify(dst)}});assert(fs.readFileSync(${JSON.stringify(dst+'/registry/manifest.json')}).equals(fs.readFileSync(${JSON.stringify(src+'/registry/manifest.json')})));assert(!fs.existsSync('server/packages'));assert(!fs.existsSync('client'));console.log('standalone-tool: OK');`],{cwd:root,env,encoding:'utf8',windowsHide:true,timeout:15000});
  expect(output).toContain('standalone-tool: OK');
 }finally{
  const resolved=fs.realpathSync(root);expect(path.dirname(resolved)).toBe(fs.realpathSync(os.tmpdir()));expect(path.basename(resolved)).toMatch(/^changmen-server-bundle-tool-/);
  fs.rmSync(resolved,{recursive:true,force:true});
 }
},30000);

it.each(['canonical'])('runs the %s CLI independently of cwd',entry=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'changmen-server-tool-cli-'));
 const write=(file,source)=>{const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,source);};
 try{
  write('server/backend/package.json','{"name":"@changmen/backend","type":"module"}');
  for(const name of ['package.json','paths.js','changmen_root.js'])write('node_modules/@changmen/storage/'+name,read('server/storage/'+name));
  write(record.source.canonical,read(record.source.canonical));
  write('server/packages/venue-adapter-tools/package.json','{"type":"module"}');
  write(record.source.file,read(record.source.file));
  write('packages/venue-adapter/scripts/package.json','{"type":"module"}');
  write('server/packages/venue-node-registry/runtime/package.json','{"type":"module"}');
  write('server/packages/venue-node-registry/runtime/registry/manifest.json','[]');
  write('node_modules/@changmen/venue-node-loader/package.json','{"type":"module","exports":"./adapter.mjs"}');
  write('node_modules/@changmen/venue-node-loader/adapter.mjs','export const fixture = true;');
  write('node_modules/@changmen/venue-node-registry/package.json','{"type":"module","exports":{"./paths.js":"./paths.js","./feeds.js":"./feeds.js"}}');
  write('node_modules/@changmen/venue-node-registry/paths.js','export const pathsFixture = true;');
  write('node_modules/@changmen/venue-node-registry/feeds.js','export const feedsFixture = true;');
  const manifest=read('packages/shared/catalog/venue_manifest.json');
  write('node_modules/@changmen/shared/package.json','{"name":"@changmen/shared","exports":{"./catalog/venue_manifest.json":"./catalog/venue_manifest.json"}}');
  write('node_modules/@changmen/shared/catalog/venue_manifest.json',manifest);
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|COMSPEC)$/i.test(key)));
  env.CHANGMEN_STORAGE_DIR=path.join(root,'storage');
  const output=execFileSync(process.execPath,[path.join(root,entry==='legacy'?record.source.file:record.source.canonical)],{cwd:os.tmpdir(),env,encoding:'utf8',windowsHide:true,timeout:15000});
  expect(output).toContain('[sync-platform-adapter]');
  expect(read(path.join(root,'server/backend/platform_adapter/registry/manifest.json'))).toBe(manifest);
 }finally{
  const resolved=fs.realpathSync(root);expect(path.dirname(resolved)).toBe(fs.realpathSync(os.tmpdir()));expect(path.basename(resolved)).toMatch(/^changmen-server-tool-cli-/);
  fs.rmSync(resolved,{recursive:true,force:true});
 }
},30000);

import {withRetiredNodeEntries} from './node-entry-retirement.mjs';
