import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {expect, it} from 'vitest';
import {restoreRayExecutionRepairSource, verifyRayExecutionRepairSources} from './ray-a8-execution-repair-boundary.mjs';
import {restorePmBalanceCredentialsSource} from './pm-balance-credentials-boundary.mjs';
const read=file=>restorePmBalanceCredentialsSource(file,fs.readFileSync(file,'utf8'));
const inventory=JSON.parse(fs.readFileSync(new URL('./ray-a8-execution-repair-increments.json',import.meta.url),'utf8'));
it.each(inventory.files)('restores only the exact execution repair in $file',row=>{
 const current=read(row.file);
 const baseline=execFileSync('git',['show',`${inventory.baseline}:${row.file}`],{encoding:'utf8'}).replaceAll('\r\n','\n');
 expect(restoreRayExecutionRepairSource(row.file,current)).toBe(baseline);
 expect(restoreRayExecutionRepairSource(row.file,current.replace(/\r?\n/g,'\r\n'))).toBe(baseline);
 expect(restoreRayExecutionRepairSource(row.file,baseline)).toBe(baseline);
 const changed=current+'\nvoid 0;';
 expect(restoreRayExecutionRepairSource(row.file,changed)).toBe(changed);
 expect(()=>verifyRayExecutionRepairSources(file=>file===row.file?changed:read(file))).toThrow('only the exact RAY A8 precheck change');
});
it('does not exempt another venue or trading orchestration',()=>{
 for(const file of ['client/packages/venue-browser/adapter/ob/bet.ts','client/web/src/stores/betting/autoBet/phases/placeArbLegs.ts'])
  expect(restoreRayExecutionRepairSource(file,'changed')).toBe('changed');
});
