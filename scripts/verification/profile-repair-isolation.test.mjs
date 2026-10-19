import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {expect,it,vi} from 'vitest';
import {inspectProfileRepairIsolation,PROFILE_REPAIR_ISOLATION as record,restoreProfileRepairSource} from './profile-repair-isolation.mjs';
const root=process.cwd();
it('extracts ten unchanged SQL sites behind nine bounded operations without moving backend cache orchestration',()=>{
 expect(inspectProfileRepairIsolation(root)).toEqual({scripts:3,querySites:10,operations:9,backendRawPoolHandles:0,reverseApplicationDependencies:0});
 const old=JSON.parse(record.metadata[0].before),next=JSON.parse(fs.readFileSync(record.metadata[0].file,'utf8'));
 delete next.exports['./maintenance/profile_repairs.js'];expect(next).toEqual(old);
 const syntax=spawnSync(process.execPath,['--check',record.dataFile],{encoding:'utf8',windowsHide:true});expect(syntax.status,syntax.stderr).toBe(0);
});
const scenarios={
 dedupe:['apply','dryRun','noChange','noKeep','empty','missingUser','readFailure','writeFailure','cacheFailure','readyFailure'],
 prune:['apply','dryRun','noChange','empty','missingUser','readFailure','writeFailure','cacheFailure','readyFailure','endFailure'],
 rebuild:['apply','dryRun','existing','foreign','missingPlayer','empty','missingUser','readFailure','writeFailure','cacheFailure','readyFailure'],
};
for(const [script,cases]of Object.entries(scenarios))for(const scenario of cases)it(`preserves native query/parameter/log/cache/close trace: ${script}/${scenario}`,()=>{
 const run=mode=>{const result=spawnSync(process.execPath,['scripts/testing/profile-repair-cli.mjs',mode,script,scenario],{encoding:'utf8',windowsHide:true,timeout:10000});expect(result.error).toBeUndefined();expect(result.stderr).toBe('');return{status:result.status,trace:JSON.parse(result.stdout)};};
 const before=run('before'),after=run('after');expect(after).toEqual(before);expect(after.trace.networkCalls).toBe(0);
 const fail=scenario.endsWith('Failure')||scenario==='missingUser';expect(after.status).toBe(fail?1:0);expect(after.trace.failure===null).toBe(!fail);
 const events=after.trace.events,queries=events.filter(e=>e[0]==='query'),writes=queries.filter(e=>e[1].startsWith('UPDATE'));
 if(['dryRun','noChange','empty'].includes(scenario)&&script!=='rebuild')expect(writes).toHaveLength(0);
 if(scenario==='dryRun')expect(writes).toHaveLength(0);
 if(scenario==='apply'){
  expect(writes).toHaveLength(1);expect(events.findIndex(e=>e[0]==='loadProfileById')).toBeGreaterThan(events.findIndex(e=>e[0]==='query'&&e[1].startsWith('UPDATE')));
  expect(events.filter(e=>e[0]==='end')).toHaveLength(script==='prune'?1:0);
 }
 if(scenario==='writeFailure')expect(events.some(e=>['loadProfileById','loadAccountsForUser'].includes(e[0]))).toBe(false);
 if(script==='rebuild'&&scenario==='foreign')expect(after.trace.warnings).toHaveLength(3);
});
it('requires the complete actual data implementation before restoring any historical CLI source',()=>{
 const row=record.entries[0],source=fs.readFileSync(row.file,'utf8');
 expect(()=>restoreProfileRepairSource(row.file,source,()=> 'missing implementation')).toThrow('Complete real profile repair persistence');
 const changed=source+'\nvoid unreviewedChange();\n';expect(restoreProfileRepairSource(row.file,changed)).toBe(changed);
});
for(const target of [record.dataFile,...record.entries.map(row=>row.file),...record.metadata.map(row=>row.file)])it('rejects unreviewed changes to '+target,()=>{
 const original=fs.readFileSync,spy=vi.spyOn(fs,'readFileSync').mockImplementation((file,...args)=>{const source=original.call(fs,file,...args);return path.resolve(file)===path.resolve(target)?source+'\nchanged':source;});
 try{expect(()=>inspectProfileRepairIsolation(root)).toThrow();}finally{spy.mockRestore();}
});
