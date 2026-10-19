import fs from 'node:fs';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {expect,it,vi} from 'vitest';
import {inspectAdminMaintenanceIsolation,ADMIN_MAINTENANCE_ISOLATION as record,restoreAdminMaintenanceSource,adminIsolationSha} from './admin-maintenance-isolation.mjs';
import {databaseAccessInventory,checkDatabaseAccessBoundaries} from './backend-db-boundary.mjs';
const root=process.cwd();
it('preserves native SQL calls, complete reports and error behavior across six scenarios without network',()=>{
 const result=spawnSync(process.execPath,['scripts/testing/admin-maintenance-native.mjs'],{encoding:'utf8',windowsHide:true,timeout:10000});
 expect(result.status,result.stderr).toBe(0);expect(JSON.parse(result.stdout)).toMatchObject({passed:true,comparisons:18,networkCalls:0});
});
it('extracts three exact queries and retires all eight backend database exceptions',()=>{
 expect(inspectAdminMaintenanceIsolation(root)).toEqual({queries:3,removedBackendAccessSites:8,remainingExceptions:0});
 expect(databaseAccessInventory(root)).toEqual([]);expect(checkDatabaseAccessBoundaries(root)).toEqual([]);
 const original=execFileSync('git',['show','c3bf0ac3e20d5221dfc36a79fc3a01f5487af9e1:'+record.file],{encoding:'utf8',windowsHide:true});
 expect(adminIsolationSha(original)).toBe(record.beforeSha);
});
it('restores only the exact complete source and requires the extracted implementation',()=>{
 const source=fs.readFileSync(record.file,'utf8');expect(restoreAdminMaintenanceSource(record.file,source)).toBe(record.before);
 expect(restoreAdminMaintenanceSource(record.file,source+'\nvoid unexpected();')).not.toBe(record.before);
 expect(()=>restoreAdminMaintenanceSource(record.file,source,()=> 'changed SQL')).toThrow();
});
for(const file of [record.file,record.dataFile,...record.metadata.map(row=>row.file)])it('rejects unreviewed changes to '+file,()=>{
 const original=fs.readFileSync,spy=vi.spyOn(fs,'readFileSync').mockImplementation((target,...args)=>{const text=original.call(fs,target,...args);return path.resolve(target)===path.resolve(file)?text+'\nchanged':text;});
 try{expect(()=>inspectAdminMaintenanceIsolation(root)).toThrow();}finally{spy.mockRestore();}
});
