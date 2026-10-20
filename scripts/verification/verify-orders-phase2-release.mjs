// [changmen 扩展] 本机只读验收独立兼容包；无数据库、场馆、SSH 或部署调用。
import assert from 'node:assert/strict';
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { deployedSource, immutableBaselines, read, gitSource, verifyPhase2Module, verifyProtectedSource } from './orders-phase2-release-boundary.mjs';
import { verifyOrdersCompatHelper } from './orders-consumer-boundary.mjs';
import { createReadonlyGitScope, verifyGitScope, scopePath } from './orders-phase2-git-scope.mjs';
const scopeText=read(scopePath);
const scope=JSON.parse(scopeText);
const normal=text=>text.replaceAll('\r\n','\n');
const sha=text=>createHash('sha256').update(normal(text)).digest('hex');
const git=createReadonlyGitScope();
const gitScope=verifyGitScope({scope,scopeText,fixedBase:deployedSource,git});
verifyOrdersCompatHelper(read);
const modules=scope.existingRuntime.map(file=>verifyPhase2Module(file));
const fixedOrders=immutableBaselines.map(base=>({base,...verifyProtectedSource('server/db/rds/orders_store.js',read('server/db/rds/orders_store.js'),gitSource(base,'server/db/rds/orders_store.js'))}));
const manifestPath='scripts/verification/vps-fok-baseline.json';
assert.equal(normal(read(manifestPath)),normal(gitSource(deployedSource,manifestPath)),'immutable VPS manifest unchanged');
const manifest=JSON.parse(read(manifestPath));
assert.equal(manifest.version,immutableBaselines[1]);
assert.equal(Object.keys(manifest.protectedFiles).length,551);
const unchanged=git.basePaths(deployedSource).filter(file=>/^(client|packages|server|chrome-extension|\.github)\//.test(file)&&!scope.existingRuntime.includes(file));
const blobs=execFileSync('git',['cat-file','--batch'],{input:unchanged.map(file=>`${deployedSource}:${file}`).join('\n')+'\n',maxBuffer:80*1024*1024});
let offset=0;
for(const file of unchanged) {
  const end=blobs.indexOf(10,offset);const header=blobs.subarray(offset,end).toString().split(' ');assert.equal(header[1],'blob');
  const size=Number(header[2]);const original=blobs.subarray(end+1,end+1+size);offset=end+1+size+1;
  const current=fs.readFileSync(file);
  assert(normal(current.toString())===normal(original.toString()),`${file}: changes outside compatibility runtime`);
}
const baselineFiles=Object.keys(manifest.protectedFiles);
const baselineBlobs=execFileSync('git',['cat-file','--batch'],{input:baselineFiles.map(file=>`${manifest.version}:${file}`).join('\n')+'\n',maxBuffer:40*1024*1024});
offset=0;
for(const file of baselineFiles) {
  const end=baselineBlobs.indexOf(10,offset);const header=baselineBlobs.subarray(offset,end).toString().split(' ');assert.equal(header[1],'blob');
  const size=Number(header[2]);const original=baselineBlobs.subarray(end+1,end+1+size).toString();offset=end+1+size+1;
  assert.equal(sha(original),manifest.protectedFiles[file],`${file}: immutable historical provenance`);
}
const result={passed:true,scope:deployedSource,changedPaths:gitScope.changedPaths,gitScope,completeRuntimeModules:modules.length,unchangedDeployedFiles:unchanged.length,immutableManifestEntries:551,fixedOrders,modules,oldControlSource:'pm_gtc_executions',compatDefault:'off',databaseAccess:false,productionWrites:false,committed:false,pushed:false,deployed:false,fullHistoricalFokReleaseAccepted:false};
fs.mkdirSync('output/orders-phase2-release',{recursive:true});fs.writeFileSync('output/orders-phase2-release/scope-verdict.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({...result,modules:undefined}));
