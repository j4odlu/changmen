import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {expect,it,vi} from 'vitest';
import {inspectRdsMaintenanceRelocation,RDS_MAINTENANCE_RELOCATION as record} from './rds-maintenance-relocation.mjs';
it('moves four pure database maintenance tools and deletes their old entries',()=>{
 expect(inspectRdsMaintenanceRelocation(process.cwd())).toEqual({moved:4,legacyEntries:0});
 for(const row of record.moves){const result=spawnSync(process.execPath,['--check',row.canonical],{encoding:'utf8',windowsHide:true});expect(result.status,result.stderr).toBe(0);}
});
for(const row of record.moves)it('rejects a returned maintenance entry: '+row.file,()=>{
 const original=fs.lstatSync,spy=vi.spyOn(fs,'lstatSync').mockImplementation((file,...args)=>path.resolve(file)===path.resolve(row.file)?{}:original.call(fs,file,...args));
 try{expect(()=>inspectRdsMaintenanceRelocation(process.cwd())).toThrow('retired maintenance entry returned');}finally{spy.mockRestore();}
});
