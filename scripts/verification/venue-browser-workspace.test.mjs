import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import path from 'node:path';
import {historicalCreateRequire as createRequire} from './workspace-layout-history.mjs';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {VENUE_BROWSER_WORKSPACE as record,restoreVenueBrowserWorkspace,verifyVenueBrowserWorkspace} from './venue-browser-workspace.mjs';
import {declaredInstallClosure,readInstallWorkspaces} from './component-install-inputs.mjs';
import {isVersionSource} from '../../devtools/runtime-tooling/runtime_version.js';
import {classifyDeployScope} from '../deploy/classify-deploy-scope.mjs';
import {restoreVenueBrowserConsumers} from './venue-browser-consumers.mjs';
const read=withAdapterHistoryReader(file=>readAdapterHistory(file,'utf8').replaceAll('\r\n','\n'));
const sha=s=>createHash('sha256').update(s).digest('hex');
const root=process.cwd(),sourceRoot='client/packages/venue-browser';
it('retains every pre-workspace source and rejects changed metadata, host code and exports',()=>{
 expect(verifyVenueBrowserWorkspace(read)).toEqual({entries:18,changedFiles:22});
 for(const row of record.changes)expect(sha(restoreVenueBrowserWorkspace(row.file,read(row.file)))).toBe(row.beforeSha);
 for(const row of [...record.changes,...record.added]){
  expect(()=>verifyVenueBrowserWorkspace(file=>read(file)+(file===row.file?'\nvoid changed();\n':''))).toThrow();
  expect(()=>verifyVenueBrowserWorkspace(file=>{if(file===row.file)throw Error('missing');return read(file);})).toThrow();
 }
},30_000);
it('registers a browser-only workspace with declared direct dependencies and exports resolving to the same physical files',()=>{
 const packages=readInstallWorkspaces(root),pkg=packages.get('@changmen/venue-browser');
 expect(pkg.dir).toBe(sourceRoot);expect(pkg.pkg.changmen.runtime).toBe('browser');
 expect(Object.keys(pkg.pkg.dependencies).sort()).toEqual(['@changmen/api-contract','@changmen/client-core','@changmen/pm-market-data-browser','@changmen/shared','@noble/hashes','@polymarket/builder-relayer-client','@polymarket/builder-signing-sdk','@polymarket/client','@polymarket/clob-client-v2','@predictdotfun/sdk','centrifuge','ethers','mqtt','socket.io-client','socketcluster-client','viem']);
 const require=createRequire(path.join(root,'packages/venue-adapter/package.json'));
 expect(Object.keys(pkg.pkg.exports)).toHaveLength(739);
 for(const [spec,target] of Object.entries(pkg.pkg.exports)){
  expect(spec).not.toContain('*');expect(target).not.toContain('..');
  expect(fs.realpathSync(require.resolve('@changmen/venue-browser'+spec.slice(1))))
   .toBe(fs.realpathSync(path.join(root,sourceRoot,target)));
 }
 expect(()=>require.resolve('@changmen/venue-browser/package.json')).toThrow();
});
it('has an acyclic frontend workspace closure, real source ownership and no backend or RDS installation reach',()=>{
 const packages=readInstallWorkspaces(root);
 const profile=declaredInstallClosure(root,packages,'@changmen/web',{build:true});
 expect(profile.violations).toEqual([]);expect(profile.workspaceDirectories).toHaveLength(8);
 expect(profile.sourceDirectories).toEqual(profile.workspaceDirectories);
 expect(profile.sourceDirectories.some(file=>file.startsWith('server/'))).toBe(false);
 const edges=new Map();
 for(const edge of profile.edges)if(edge.target)edges.set(edge.from,[...(edges.get(edge.from)||[]),edge.target]);
 function visit(file,parents){expect(parents,parents.join(' -> ')+' -> '+file).not.toContain(file);for(const next of edges.get(file)||[])visit(next,[...parents,file]);}
 visit('client/web',[]);
 expect(declaredInstallClosure(root,packages,'@changmen/venue-browser').workspaces)
  .toEqual(['@changmen/api-contract','@changmen/client-core','@changmen/pm-market-data-browser','@changmen/shared','@changmen/venue-browser']);
 for(const name of ['@changmen/backend','@changmen/db'])expect(declaredInstallClosure(root,packages,name).workspaces).not.toContain('@changmen/venue-browser');
});
it('changes lock records only for the new workspace, its link and declared consumer',()=>{
 const current=JSON.parse(restoreVenueBrowserConsumers('package-lock.json',read('package-lock.json')));
 const previous=JSON.parse(restoreVenueBrowserWorkspace('package-lock.json',read('package-lock.json')));
 expect(Object.keys(current.packages).filter(file=>!Object.hasOwn(previous.packages,file)).sort())
  .toEqual(['client/packages/venue-browser','node_modules/@changmen/venue-browser']);
 for(const [file,value] of Object.entries(previous.packages))if(!['','packages/venue-adapter'].includes(file))expect(current.packages[file],file).toEqual(value);
});
it('all adapter runtime consumers use declared exports instead of reaching into the client directory',()=>{
 const consumers=record.changes.filter(row=>row.file.endsWith('.ts'));
 expect(consumers).toHaveLength(18);
 for(const row of consumers){expect(read(row.file)).not.toContain('client/packages/venue-browser/');expect(read(row.file)).toContain('@changmen/venue-browser/');}
});
it('keeps the browser manifest in both fingerprints while publishing it only to the frontend',()=>{
 const file=sourceRoot+'/package.json';
 expect(isVersionSource(file,'frontend')).toBe(true);expect(isVersionSource(file,'backend')).toBe(false);
 expect(classifyDeployScope([file])).toBe('frontend');
});
