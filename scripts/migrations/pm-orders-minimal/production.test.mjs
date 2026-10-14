import fs from "node:fs";
import { beforeAll,describe,it,expect,vi } from "vitest";
import { connectionOptions,main,parseArgs,writeImmutable } from "./production.mjs";
import { digest,seal,verifyArtifact,requireConsumers,MAX_BATCH } from "./production-tools.mjs";
const ca="output/pm-orders-minimal-test-ca.pem";
beforeAll(()=>{fs.mkdirSync("output",{recursive:true});fs.writeFileSync(ca,"test-ca");});
const target={database:"migration-db",role:"migration-role",address:"10.0.0.1",port:5432};
const config={version:1,urlEnv:"PM_MIGRATION_URL",expectedTarget:target,tlsCaFile:ca};
describe("explicit migration guard",()=>{
 it("default invocation does not inspect credentials or connect",async()=>{const log=vi.spyOn(console,"log").mockImplementation(()=>{});try{await main([]);expect(JSON.parse(log.mock.calls[0][0]).databaseConnected).toBe(false);}finally{log.mockRestore();}});
 it("retired storage mode rejects explicit execution before reading config or creating output",async()=>{
   const output="output/retired-minimal-must-not-exist-"+Date.now();
   await expect(main(["--execute","--command","schema-plan","--config","missing-secret-config.json","--out",output])).rejects.toThrow("RETIRED_STORAGE_MODE_USE_TWO_TABLE_GTC");
   expect(fs.existsSync(output)).toBe(false);
 });
 it.each(["--command bad","--execute","--execute --command batch-apply --config c --out x","--out x --out y","--database-url secret"])("rejects incomplete or unsafe args %s",args=>expect(()=>parseArgs(args.split(" "))).toThrow());
 it("requires explicit migration URL rather than DATABASE_URL",()=>expect(()=>connectionOptions(config,{DATABASE_URL:"postgresql://migration-role:secret@db/migration-db"})).toThrow("MIGRATION_URL_NOT_SET"));
 it.each(["?sslmode=disable","?options=-csearch_path%3Devil","#fragment"])("rejects URL override %s",suffix=>expect(()=>connectionOptions(config,{PM_MIGRATION_URL:"postgresql://migration-role:secret@db/migration-db"+suffix})).toThrow("PLAIN_EXPLICIT"));
 it("uses checked TLS and explicit expected identity",()=>{const c=connectionOptions(config,{PM_MIGRATION_URL:"postgresql://migration-role:secret@db/migration-db"});expect(c.ssl).toEqual({ca:"test-ca",rejectUnauthorized:true});expect(c.database).toBe(target.database);});
 it("rejects wrong database and role",()=>expect(()=>connectionOptions(config,{PM_MIGRATION_URL:"postgresql://other:secret@db/other"})).toThrow("MISMATCH"));
 it("binds immutable artifacts to complete canonical content",()=>{const a=seal({kind:"batch-plan",version:1,x:{b:2,a:1}});expect(verifyArtifact(a,"batch-plan").x.a).toBe(1);expect(digest({b:2,a:1})).toBe(digest({a:1,b:2}));expect(()=>verifyArtifact({...a,x:{a:99}},"batch-plan")).toThrow("ARTIFACT_CHANGED");});
 it("rejects nonfinite receipt values",()=>expect(()=>digest({x:NaN})).toThrow("NONFINITE"));
 it.each([{}, {allConsumersCompatible:true,target}, {allConsumersCompatible:true,target,oldExecutionSource:"pm_gtc_executions",legacyFlag:"0",minimalFlag:"0"}])("cannot apply without retained compatible reads and paused projections",a=>expect(()=>requireConsumers(a,target,"apply")).toThrow());
 it("requires schema install flags off and data writes flags on",()=>{const a={target,allConsumersCompatible:true,oldExecutionSource:"pm_gtc_executions",legacyFlag:"0",minimalFlag:"1",projectionWritesPaused:true,financialFilteringRetained:true};expect(()=>requireConsumers(a,target,"apply")).not.toThrow();expect(()=>requireConsumers(a,target,"install")).toThrow("FLAGS_OFF");});
 it("cannot overwrite an existing durable artifact",()=>{const file="output/pm-orders-minimal-receipt-unit-"+Date.now()+".json";writeImmutable(file,{x:1});expect(()=>writeImmutable(file,{x:2})).toThrow();expect(JSON.parse(fs.readFileSync(file))).toEqual({x:1});});
 it("limits transactions to an explicit small batch",()=>expect(MAX_BATCH).toBe(25));
});
