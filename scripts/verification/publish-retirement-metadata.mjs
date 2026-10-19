// [changmen 扩展] Finite historical metadata views; no runtime aliases or baseline changes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../../',import.meta.url));
export const retirementMetadataSha=source=>createHash('sha256').update(source.replaceAll('\r\n','\n')).digest('hex');
const text=fs.readFileSync(new URL('./publish-retirement-metadata.json',import.meta.url),'utf8');
assert.equal(retirementMetadataSha(text),'8b093eae53227dfc8198732df9ba3c2452bd0414291a39a9f4ffb4c08b6f6d74');
export const PUBLISH_RETIREMENT_METADATA=JSON.parse(text);
const record=PUBLISH_RETIREMENT_METADATA;
assert.equal(record.purpose,'retire-unused-package-manifests-and-preserve-exact-policy-history');assert.equal(record.retiredManifests.length,3);
export const retiredManifestHistoryFiles=record.retiredManifests.map(row=>row.file);
const historyFiles=new Set([...retiredManifestHistoryFiles,...record.metadata.map(row=>row.file),record.policy.file]);
const relative=file=>typeof file==='string'&&historyFiles.has(file)?file:path.relative(root,file instanceof URL?fileURLToPath(file):path.resolve(file)).replaceAll('\\','/');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
export function restoreRetirementComponentMetadata(file,source){
 const row=record.metadata.find(row=>row.file===relative(file));if(!row||retirementMetadataSha(source)!==row.afterSha)return source;
 for(const manifest of record.retiredManifests)checkManifest(manifest,read);
 assert.equal(retirementMetadataSha(row.before),row.beforeSha);return row.before;
}
function checkManifest(row,source){
 assert.equal(retirementMetadataSha(source(row.canonicalPackage)),row.canonicalSha,'Complete canonical package metadata required');
 for(const target of row.targets)assert.equal(retirementMetadataSha(source(target.file)),target.sha,target.file+': implementation changed; complete canonical public implementation required');
 assert.equal(retirementMetadataSha(row.before),row.beforeSha);assert.equal(JSON.parse(row.before).name,JSON.parse(source(row.canonicalPackage)).name);
}
export function previousRetiredPackageManifest(file,source=read){
 const row=record.retiredManifests.find(row=>row.file===relative(file));if(!row)return undefined;
 checkManifest(row,source);return row.before;
}
export function restoreRetirementPolicy(file,source,readSource=read){
 const policy=record.policy;if(file!==policy.file||retirementMetadataSha(source)!==policy.afterSha)return source;
 for(const proof of policy.proofs)assert.equal(retirementMetadataSha(readSource(proof.file)),proof.sha,'Complete retired-policy canonical proof required');
 assert.equal(retirementMetadataSha(policy.before),policy.beforeSha);return policy.before;
}
export function inspectPublishRetirementMetadata(base){
 base=fs.realpathSync(base);
 const source=file=>{const real=fs.realpathSync(path.join(base,file)),rel=path.relative(base,real);assert(rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel));return fs.readFileSync(real,'utf8');};
 const pkg=JSON.parse(source('package.json'));
 for(const row of record.metadata){
  const current=source(row.file);assert.equal(retirementMetadataSha(current),row.afterSha,'Conservative package input redirection changed');
  const expected=JSON.parse(row.before);for(const manifest of record.retiredManifests)expected.conservativeInputs=expected.conservativeInputs.map(file=>file===manifest.file?manifest.canonicalPackage:file);
  assert.deepEqual(JSON.parse(current),expected,'Conservative inputs must follow the canonical manifests without dropping coverage');
 }
 for(const row of record.retiredManifests){
  assert(!fs.lstatSync(path.join(base,row.file),{throwIfNoEntry:false}),'Retired package manifest must not return');
  assert(!pkg.workspaces.includes(path.posix.dirname(row.file)));assert(pkg.workspaces.includes(path.posix.dirname(row.canonicalPackage)));checkManifest(row,source);
 }
 const current=source(record.policy.file);assert.equal(retirementMetadataSha(current),record.policy.afterSha,'Unreviewed retained policy changes');
 const expected=JSON.parse(record.policy.before),assets=expected.groups.find(row=>row.id==='rds-assets'),database=expected.groups.find(row=>row.id==='frozen-database-island');
 assets.files=assets.files.filter(file=>!file.startsWith('server/backend/'));
 assets.reason='Canonical SQL and schema baseline remain pinned after retirement of backend compatibility copies.';
 assets.exitCondition='A separately reviewed schema evolution preserves published compatibility; backend copies must not return.';
 database.reason='All eight direct database locations were retired by exact read-only SQL extraction; the original exception contract is retained as historical proof.';
 database.exitCondition='Keep backend business SQL exceptions empty and preserve the complete original report and query behavior; no exception may return.';
 assert.deepEqual(JSON.parse(current),expected,'Only reviewed RDS copy and access-exception retirement may change the retained policy');
 assert.equal(restoreRetirementPolicy(record.policy.file,current,source),record.policy.before);
 return{retiredPackageManifests:3,retainedPolicyHistoryPreserved:true,publishScopeOptimizationEnabled:false};
}
