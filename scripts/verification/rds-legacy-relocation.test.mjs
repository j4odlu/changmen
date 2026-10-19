import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {expect,it,vi} from 'vitest';
import {inspectRdsLegacyRelocation,RDS_LEGACY_RELOCATION as record,previousRdsLegacyEntry,restoreRdsLegacyMetadata} from './rds-legacy-relocation.mjs';
const root=process.cwd();
it('physically moves 130 scripts while preserving all native import targets and executable bodies',()=>{
 expect(inspectRdsLegacyRelocation(root)).toMatchObject({moved:130,unchanged:127,relativeImportUpdates:3,reverseApplicationDependencies:0});
});
it('parses every moved script with native Node without importing or running maintenance',()=>{
 for(const row of record.moves){const result=spawnSync(process.execPath,['--check',row.canonical],{encoding:'utf8',windowsHide:true});expect(result.status,row.canonical+': '+result.stderr).toBe(0);}
},30000);
it('historical reads require the exact real moved implementation and never mask unrelated errors',()=>{
 for(const row of record.moves)expect(previousRdsLegacyEntry(row.file,file=>fs.readFileSync(file,'utf8'))).toBe(row.before);
 expect(previousRdsLegacyEntry('server/unrelated.js',()=>{throw Error('must not read');})).toBeUndefined();
 expect(()=>previousRdsLegacyEntry(record.moves[0].file,()=> 'changed SQL')).toThrow('exact relocated data script required');
 expect(()=>previousRdsLegacyEntry(record.moves[0].file,()=>{throw Error('missing implementation');})).toThrow('missing implementation');
 for(const row of record.metadata){const current=fs.readFileSync(row.file,'utf8');expect(restoreRdsLegacyMetadata(row.file,current)).toBe(row.before);expect(restoreRdsLegacyMetadata(row.file,current+'\nvoid unreviewed;')).not.toBe(row.before);}
});
for(const row of [record.moves[0],...record.moves.filter(row=>row.replacements.length)])it('rejects changed SQL or imports in '+row.canonical,()=>{
 const original=fs.readFileSync,spy=vi.spyOn(fs,'readFileSync').mockImplementation((file,...args)=>{const source=original.call(fs,file,...args);return path.resolve(file)===path.resolve(row.canonical)?source+'\nvoid changedMaintenance();':source;});
 try{expect(()=>inspectRdsLegacyRelocation(root)).toThrow('complete relocated source changed');}finally{spy.mockRestore();}
});
it('rejects a retired script returning as a wrapper or implementation',()=>{
 const original=fs.lstatSync,row=record.moves[0],spy=vi.spyOn(fs,'lstatSync').mockImplementation((file,...args)=>path.resolve(file)===path.resolve(row.file)?{}:original.call(fs,file,...args));
 try{expect(()=>inspectRdsLegacyRelocation(root)).toThrow('retired data script returned');}finally{spy.mockRestore();}
});
it('keeps all four public npm command names and resolves their new files from the backend cwd',()=>{
 const pkg=JSON.parse(fs.readFileSync('server/backend/package.json','utf8'));
 for(const name of ['db:migrate-players-owner','db:migrate-accounts-from-jsonb','db:finalize-players-owner','db:check-players']){
  expect(pkg.scripts[name]).toMatch(/^node \.\.\/db\/maintenance\/legacy\/migrations\//);
  expect(fs.existsSync(path.resolve('server/backend',pkg.scripts[name].slice(5)))).toBe(true);
  expect(pkg.scripts[name]).not.toMatch(/--(?:apply|execute)/);
 }
});
