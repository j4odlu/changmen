// [changmen 扩展] Four physical moves with exact resource-path changes only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const sha=text=>createHash('sha256').update(text.replaceAll('\r\n','\n')).digest('hex');
const text=fs.readFileSync(new URL('./rds-maintenance-relocation.json',import.meta.url),'utf8');
assert.equal(sha(text),'596504924f06ec0c16388404c2bd92570ec5c7a076490515686216fc9eb2ade5');
export const RDS_MAINTENANCE_RELOCATION=JSON.parse(text);
assert.equal(RDS_MAINTENANCE_RELOCATION.purpose,'move-rds-maintenance-tools-only');
export function inspectRdsMaintenanceRelocation(base){
 base=fs.realpathSync(base);
 for(const row of RDS_MAINTENANCE_RELOCATION.moves){
  assert(!fs.lstatSync(path.join(base,row.file),{throwIfNoEntry:false}),row.file+': retired maintenance entry returned');
  const real=fs.realpathSync(path.join(base,row.canonical)),relative=path.relative(base,real);
  assert(relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative));
  const actual=fs.readFileSync(real,'utf8');assert.equal(sha(actual),row.afterSha,row.canonical+': maintenance implementation changed');
  let expected=row.before;assert.equal(sha(expected),row.beforeSha);
  for(const[before,after]of row.replacements){assert.equal(expected.split(before).length,2);expected=expected.replace(before,after);}
  assert.equal(actual.replaceAll('\r\n','\n'),expected,'Only reviewed resource paths may change');
 }
 return {moved:4,legacyEntries:0};
}
