import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {expect,it,vi} from 'vitest';
import {PUBLISH_RETIREMENT_METADATA as record,inspectPublishRetirementMetadata,previousRetiredPackageManifest,restoreRetirementPolicy,restoreRetirementComponentMetadata} from './publish-retirement-metadata.mjs';
const read=file=>fs.readFileSync(file,'utf8');
it('restores logical conservative-input paths when freeze checks run from a workspace directory',()=>{
 const url=new URL('./publish-retirement-metadata.mjs',import.meta.url).href,root=process.cwd();
 const code=`import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import{PUBLISH_RETIREMENT_METADATA as record,restoreRetirementComponentMetadata}from ${JSON.stringify(url)};for(const row of record.metadata)assert.equal(restoreRetirementComponentMetadata(row.file,fs.readFileSync(path.join(${JSON.stringify(root)},row.file),'utf8')),row.before);`;
 for(const cwd of ['packages/venue-adapter','server/backend']){const result=spawnSync(process.execPath,['--input-type=module','--eval',code],{cwd:path.join(root,cwd),encoding:'utf8',windowsHide:true,timeout:10000});expect(result.status,result.stderr).toBe(0);}
});
it('removes unused manifests and preserves the entire original retained policy without deregistering protection',()=>{
 expect(inspectPublishRetirementMetadata(process.cwd())).toEqual({retiredPackageManifests:3,retainedPolicyHistoryPreserved:true,publishScopeOptimizationEnabled:false});
 expect(restoreRetirementPolicy(record.policy.file,read(record.policy.file))).toBe(record.policy.before);
 for(const row of record.metadata){expect(restoreRetirementComponentMetadata(row.file,read(row.file))).toBe(row.before);const changed=read(row.file)+'\n';expect(restoreRetirementComponentMetadata(row.file,changed)).toBe(changed);}
});
for(const row of record.retiredManifests)it('keeps '+row.file+' absent and requires real canonical metadata and implementations for historical reads',async()=>{
 expect(fs.existsSync(row.file)).toBe(false);await expect(import(new URL('../../'+row.file,import.meta.url).href)).rejects.toThrow();
 expect(previousRetiredPackageManifest(row.file,read)).toBe(row.before);
 for(const target of [row.canonicalPackage,...row.targets.map(r=>r.file)])expect(()=>previousRetiredPackageManifest(row.file,file=>file===target?read(file)+'\nchanged':read(file))).toThrow();
});
it('cannot conceal extra retained-policy changes or substitute missing canonical SQL/report proofs',()=>{
 const current=read(record.policy.file),changed=current+'\n';expect(restoreRetirementPolicy(record.policy.file,changed)).toBe(changed);
 for(const proof of record.policy.proofs)expect(()=>restoreRetirementPolicy(record.policy.file,current,file=>file===proof.file?'changed':read(file))).toThrow('Complete retired-policy canonical proof');
 expect(previousRetiredPackageManifest('unrelated.json',read)).toBeUndefined();
});
it('rejects a legacy manifest returning',()=>{
 const original=fs.lstatSync,spy=vi.spyOn(fs,'lstatSync').mockImplementation((file,...args)=>path.resolve(file)===path.resolve(record.retiredManifests[0].file)?{}:original.call(fs,file,...args));
 try{expect(()=>inspectPublishRetirementMetadata(process.cwd())).toThrow('Retired package manifest');}finally{spy.mockRestore();}
});
it('rejects changes to the actual retained policy',()=>{
 const original=fs.readFileSync,spy=vi.spyOn(fs,'readFileSync').mockImplementation((file,...args)=>{const result=original.call(fs,file,...args);return path.resolve(file)===path.resolve(record.policy.file)?result+'\nchanged':result;});
 try{expect(()=>inspectPublishRetirementMetadata(process.cwd())).toThrow('Unreviewed retained policy');}finally{spy.mockRestore();}
});
