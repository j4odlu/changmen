import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import {expect,it} from 'vitest';
import {CATALOG_ENVIRONMENT_ISOLATION as record,verifyCatalogEnvironmentIsolation,inspectCatalogEnvironmentIsolation,restoreCatalogEnvironmentMetadata} from './catalog-environment-isolation.mjs';
const read=file=>fs.readFileSync(file,'utf8');
it('keeps environment selection in the server adapter and every real consumer on its public entry',()=>{
 expect(inspectCatalogEnvironmentIsolation(process.cwd())).toMatchObject({sharedEnvironmentReads:0,esmConsumers:7,cjsConsumers:2});
 expect(read('packages/shared/catalog/game_catalog.ts')).not.toMatch(/process\.env/);
});
it.each([...record.changes,...record.assets])('rejects changed or missing extraction input: $file',row=>{
 expect(()=>verifyCatalogEnvironmentIsolation(file=>read(file)+(file===row.file?'\nvoid unreviewed();':''))).toThrow();
 expect(()=>verifyCatalogEnvironmentIsolation(file=>{if(file===row.file)throw Error('missing input');return read(file);})).toThrow();
});
it('restores only the exact reviewed full source in historical checks',()=>{
 for(const row of record.changes){expect(restoreCatalogEnvironmentMetadata(row.file,read(row.file))).toBe(row.before);expect(restoreCatalogEnvironmentMetadata(row.file,read(row.file)+'\n')).not.toBe(row.before);}
});
