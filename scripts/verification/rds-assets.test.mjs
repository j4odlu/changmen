// [changmen 扩展] Canonical history is immutable; old copies must stay absent.
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {expect,it} from 'vitest';
import {inspectRdsAssets} from './rds-assets.mjs';
import {listRdsMigrationNames,readRdsMigrationSql,readRdsSchemaBaseline} from "../../rds/maintenance/assets.mjs";
const checksum=text=>createHash('sha256').update(text.replaceAll('\r\n','\n')).digest('hex');
function fixture(run){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'changmen-rds-assets-'));
 const write=(file,value)=>{fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),value);};
 const sql='BEGIN;\nSELECT 1;\nCOMMIT;\n',baseline=JSON.stringify({migrations:{'001_fixture.sql':checksum(sql)}});
 write('server/db/assets/schema-baseline.json',baseline);write('server/db/assets/migrations/001_fixture.sql',sql);
 write('scripts/verification/retained-source-boundaries.json',JSON.stringify({groups:[{id:'rds-assets',baselineSha256:checksum(baseline)}]}));
 try{run({root,write,sql});}finally{if(path.dirname(root)===path.resolve(os.tmpdir())&&path.basename(root).startsWith('changmen-rds-assets-'))fs.rmSync(root,{recursive:true,force:true});}
}
it('reads the unchanged historical manifest and all 43 SQL files from the data package',()=>{
 const baseline=readRdsSchemaBaseline();expect(listRdsMigrationNames()).toEqual(Object.keys(baseline.migrations).sort());expect(listRdsMigrationNames()).toHaveLength(43);
 for(const[name,hash]of Object.entries(baseline.migrations))expect(checksum(readRdsMigrationSql(name))).toBe(hash);
 const report=inspectRdsAssets(fileURLToPath(new URL('../../',import.meta.url)));expect(report.assets).toBe(44);expect(report.violations).toEqual([]);
});
for(const name of ['../001_fixture.sql','/001_fixture.sql','001_fixture.sql?other','001_fixture.sql#other','file:001_fixture.sql','001_fixture.sql/other'])it('rejects non-filename asset '+name,()=>expect(()=>readRdsMigrationSql(name)).toThrow('Invalid RDS migration asset name'));
it('checks canonical assets without recreating backend copies',()=>fixture(({root})=>{expect(inspectRdsAssets(root).violations).toEqual([]);expect(fs.existsSync(path.join(root,'server/backend'))).toBe(false);}));
for(const file of ['server/backend/db/migrations/001_fixture.sql','server/backend/scripts/rds-schema-baseline.json'])it('rejects a returned backend asset: '+file,()=>fixture(({root,write,sql})=>{write(file,sql);expect(inspectRdsAssets(root).violations).toHaveLength(1);}));
it('rejects modified canonical SQL',()=>fixture(({root,write})=>{write('server/db/assets/migrations/001_fixture.sql','SELECT changed;');expect(()=>inspectRdsAssets(root)).toThrow('checksum changed');}));
it('rejects unlisted canonical SQL',()=>fixture(({root,write})=>{write('server/db/assets/migrations/002_unreviewed.sql','SELECT 1;');expect(()=>inspectRdsAssets(root)).toThrow('cover every SQL file');}));
it('never falls back to a backend copy',()=>fixture(({root,write,sql})=>{write('server/backend/db/migrations/001_fixture.sql',sql);fs.unlinkSync(path.join(root,'server/db/assets/migrations/001_fixture.sql'));expect(()=>inspectRdsAssets(root)).toThrow('cover every SQL file');}));
