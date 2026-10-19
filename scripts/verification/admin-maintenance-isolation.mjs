// [changmen 扩展] Exact SQL extraction, preserving full prior report source for historical checks.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {restoreRdsLegacyMetadata} from './rds-legacy-relocation.mjs';
import {restoreRdsContextMetadata} from './rds-context-relocation.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
export const adminIsolationSha=source=>createHash('sha256').update(source.replaceAll('\r\n','\n')).digest('hex');
const text=fs.readFileSync(new URL('./admin-maintenance-isolation.json',import.meta.url),'utf8');
assert.equal(adminIsolationSha(text),'33f59d10b95e8c1872283e8bb4273408abc48e5c5c924cd4fef8158715045dc5');
export const ADMIN_MAINTENANCE_ISOLATION=JSON.parse(text);
const record=ADMIN_MAINTENANCE_ISOLATION;
assert.equal(record.purpose,'extract-admin-maintenance-readonly-sql-only');
assert.equal(record.publishScopeOptimizationEnabled,false);
assert.equal(adminIsolationSha(record.before),record.beforeSha);
export const adminIsolationHistoryFiles=[record.file,...record.metadata.map(row=>row.file)];
const relative=file=>typeof file==='string'&&adminIsolationHistoryFiles.includes(file)?file:path.relative(root,file instanceof URL?fileURLToPath(file):path.resolve(file)).replaceAll('\\','/');
const readCurrent=file=>fs.readFileSync(path.join(root,file),'utf8');
export function restoreAdminMaintenanceSource(file,source,read=readCurrent){
 if(relative(file)!==record.file||adminIsolationSha(source)!==record.afterSha)return source;
 assert.equal(adminIsolationSha(read(record.dataFile)),record.dataSha,'Complete extracted SQL implementation must remain unchanged');
 return record.before;
}
export function restoreAdminMaintenanceMetadata(file,source){
 source=restoreRdsLegacyMetadata(file,source);
 source=restoreAdminMaintenanceSource(file,source);
 const row=record.metadata.find(row=>row.file===relative(file));
 if(!row||adminIsolationSha(source)!==row.afterSha)return source;
 assert.equal(adminIsolationSha(row.before),row.beforeSha);return row.before;
}
export function inspectAdminMaintenanceIsolation(base){
 base=fs.realpathSync(base);
 const read=file=>{const real=fs.realpathSync(path.join(base,file)),rel=path.relative(base,real);
  assert(rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel));return fs.readFileSync(real,'utf8');};
 assert.equal(adminIsolationSha(read(record.file)),record.afterSha,'Reviewed backend report extraction changed');
 assert.equal(adminIsolationSha(read(record.dataFile)),record.dataSha,'Extracted SQL changed');
 for(const row of record.metadata)assert.equal(adminIsolationSha(restoreRdsContextMetadata(row.file,read(row.file))),row.afterSha,row.file+': reviewed data port metadata');
 const exceptions=JSON.parse(read('scripts/verification/backend-db-access-exceptions.json'));
 assert.deepEqual(exceptions.sites,[],'Backend database exceptions must stay empty');
 let reconstructed=read(record.file).replace('import { readSharedVenueAccountRows, readDuplicateOrderRows } from "@changmen/db/admin_maintenance.js";','import { ensurePgPoolReady, financialOrdersRelation, getPgPool } from "@changmen/db";');
 for(const block of record.blocks){
  assert.equal(reconstructed.split(block.replacement).length,2);reconstructed=reconstructed.replace(block.replacement,block.source);
  assert(read(record.dataFile).includes(block.source+block.result),'Query body must be extracted verbatim');
 }
 assert.equal(adminIsolationSha(reconstructed),record.beforeSha,'Complete prior report must reconstruct, including sorting and display messages');
 return {queries:3,removedBackendAccessSites:8,remainingExceptions:0};
}
