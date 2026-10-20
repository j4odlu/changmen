import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {expect,it,vi} from 'vitest';
import {inspectRdsContextRelocation,RDS_CONTEXT_RELOCATION as record,contextResourceTargets,restoreRdsContextMetadata,previousRdsContextEntry} from './rds-context-relocation.mjs';
const root=process.cwd();
it('moves ten scripts with unchanged SQL and resource context, repairing one broken historical import',()=>{
 expect(inspectRdsContextRelocation(root)).toMatchObject({moved:10,unchanged:4,repairedImports:1,resourceTargetsPreserved:true,newLockedPackageVersions:0});
 for(const row of record.moves){const result=spawnSync(process.execPath,['--check',row.canonical.replace('server/db/','rds/')],{encoding:'utf8',windowsHide:true});expect(result.status,result.stderr).toBe(0);}
});
it('preserves original environment files and default/explicit backup paths in different checkout roots',()=>{
 for(const base of [root,path.join(os.tmpdir(),'synthetic-context-checkout')])for(const row of record.moves){
  const current=fs.readFileSync(row.canonical,'utf8');
  for(const outArg of [undefined,'relative.json',path.join(base,'absolute.json')])expect(contextResourceTargets(row,current,path.join(base,row.canonical),{outArg})).toEqual(contextResourceTargets(row,row.before,path.join(base,row.file),{outArg}));
 }
 const backup=record.moves.find(row=>row.context==='backup-root');
 expect(contextResourceTargets(backup,fs.readFileSync(backup.canonical,'utf8'),path.resolve(backup.canonical)).out).toBe(path.join(root,'server/backend/storage/backups/players-accounts-1792440000000.json'));
 const legacyEnv=record.moves.find(row=>row.context==='original-ops-env');
 expect(contextResourceTargets(legacyEnv,fs.readFileSync(legacyEnv.canonical,'utf8'),path.resolve(legacyEnv.canonical)).env).toBe(path.join(root,'server/backend/scripts/ops/.env'));
});
it('uses the same actual pure identity functions without importing a match workspace from RDS',()=>{
 const code=`import assert from 'node:assert/strict';import * as old from '@changmen/shared/match-identity';import * as next from '@changmen/shared/match-identity/teams/team_key.js';assert.equal(old.normalizeTeam,next.normalizeTeam);assert.equal(old.canonicalMatchKeyByName,next.canonicalMatchKeyByName);await assert.rejects(import('@changmen/match-identity'),{code:'ERR_MODULE_NOT_FOUND'});console.log('same');`;
 const result=spawnSync(process.execPath,['--input-type=module','--eval',code],{encoding:'utf8',windowsHide:true});expect(result.status,result.stderr).toBe(0);expect(result.stdout.trim()).toBe('same');
});
for(const scenario of ['missingArgs','missingDb','missingJwt','create','updateAdmin','profileFailure','queryFailure'])it('keeps native user CLI behavior: '+scenario,()=>{
 const run=mode=>{const result=spawnSync(process.execPath,['scripts/testing/context-user-cli.mjs',mode,scenario],{encoding:'utf8',windowsHide:true,timeout:10000});expect(result.error).toBeUndefined();expect(result.stderr).toBe('');return{status:result.status,trace:JSON.parse(result.stdout)};};
 const old=run('before'),next=run('after');expect(next).toEqual(old);expect(next.trace.networkCalls).toBe(0);
 expect(next.status).toBe(['create','updateAdmin'].includes(scenario)?0:1);
 if(scenario==='create'||scenario==='updateAdmin'){expect(next.trace.events.filter(e=>e[0]==='query')).toHaveLength(2);expect(next.trace.events.filter(e=>e[0]==='profile')).toHaveLength(1);expect(next.trace.events.filter(e=>e[0]==='end')).toHaveLength(1);}
});
it('restores the complete prior lock and rejects added dependency changes or missing implementations',()=>{
 const lock=fs.readFileSync(record.lock.file,'utf8'),before=JSON.parse(restoreRdsContextMetadata(record.lock.file,lock)),after=JSON.parse(lock);
 after.packages['server/db']=record.lock.beforeEntry;expect(after).toEqual(before);
 expect(restoreRdsContextMetadata(record.lock.file,lock+'\n')).toBe(lock+'\n');
 for(const row of record.moves)expect(previousRdsContextEntry(row.file,file=>fs.readFileSync(file,'utf8'))).toBe(row.before);
 expect(()=>previousRdsContextEntry(record.moves[0].file,()=> 'changed')).toThrow('exact context relocation required');
});
for(const target of [record.moves[0].canonical,record.moves.find(row=>row.context==='backup-root').canonical,...record.metadata.map(row=>row.file),record.lock.file])it('rejects unreviewed changes to '+target,()=>{
 const original=fs.readFileSync,spy=vi.spyOn(fs,'readFileSync').mockImplementation((file,...args)=>{const text=original.call(fs,file,...args);return path.resolve(file)===path.resolve(target)?text+'\nchanged':text;});
 try{expect(()=>inspectRdsContextRelocation(root)).toThrow();}finally{spy.mockRestore();}
});
