import {describe,it,expect} from "vitest";
import {assertPostgresEvidence,assertReleaseEvidence,objectDigest,phasesExpected,retryablePublicNetworkFailure} from "./pm-orders-minimal-acceptance.mjs";
import {createHash} from "node:crypto";
const network="TypeError: fetch failed secure TLS connection code: ECONNRESET host: changmen.fun";
const backend="FAIL core/integrations/polymarket/clob_proxy.test.mjs > public GET /time\nTypeError: fetch failed ECONNRESET host clob.polymarket.com\nTests 1 failed | 385 passed\nFailed: @changmen/backend#test\n";
function fixture(){return {passed:true,evidenceConsistent:true,inputUnchanged:true,inputDigest:objectDigest({source:"hash"}),immutableBaselines:["219535c8","75b1efac66625e5f2bc9884a965b244bfaf337ed"],results:phasesExpected.map(phase=>({phase,passed:true,attempts:[{exitCode:0}]})),productionDatabaseConnected:false,productionWrites:false,committed:false,pushed:false,deployed:false};}
describe("final acceptance retains failures without broad exemptions",()=>{
 it("accepts only complete, current, actual passes",()=>expect(()=>assertReleaseEvidence(fixture(),{source:"hash"})).not.toThrow());
 it.each(["fok-core","candidate-scope","protection-negative","order-business"])("never retries protected assertion failures in %s",phase=>expect(retryablePublicNetworkFailure(phase,network)).toBe(false));
 it.each(["capture","public-entries","release-stability"])("permits one unchanged public TLS retry in %s",phase=>expect(retryablePublicNetworkFailure(phase,network)).toBe(true));
 it("limits backend retry to the sole public time test",()=>{expect(retryablePublicNetworkFailure("backend",backend)).toBe(true);for(const mutant of [backend.replace("1 failed","2 failed"),backend.replace("public GET /time","submit real order"),backend+"Failed: @changmen/matcher#test\n",backend.replace("ECONNRESET","assertion error")])expect(retryablePublicNetworkFailure("backend",mutant)).toBe(false);});
 it("preserved failed attempt cannot be marked accepted without an actual passing retry",()=>{const r=fixture();r.results[9].attempts=[{exitCode:1,retryableNetworkFailure:true,inputUnchanged:true}];expect(()=>assertReleaseEvidence(r,{source:"hash"})).toThrow();});
 it("source drift invalidates otherwise passing evidence",()=>expect(()=>assertReleaseEvidence(fixture(),{source:"changed"})).toThrow("stale"));
 it.each(["missing phase","new baseline","third attempt","non-network retry","changed retry input"])("rejects %s",mutant=>{const r=fixture();if(mutant==="missing phase")r.results.pop();else if(mutant==="new baseline")r.immutableBaselines[0]="313c19e8";else if(mutant==="third attempt")r.results[0].attempts=[{exitCode:1},{exitCode:1},{exitCode:0}];else r.results[0].attempts=[{exitCode:1,retryableNetworkFailure:mutant!=="non-network retry",inputUnchanged:mutant!=="changed retry input"},{exitCode:0}];expect(()=>assertReleaseEvidence(r,{source:"hash"})).toThrow();});
 it.each(["stale source","missing source","skipped test","wrong database","production verified"])("rejects PostgreSQL %s evidence",mutant=>{
   const sha=createHash("sha256").update("current").digest("hex"),files=["scripts/migrations/pm-orders-minimal/schema.sql","scripts/migrations/pm-orders-minimal/production-tools.mjs","scripts/migrations/pm-orders-minimal/production.mjs","scripts/migrations/pm-orders-minimal/postgres-tools-cases.mjs","server/db/rds/pm_orders_minimal.js"];
   const r={databaseIntegrationAccepted:true,expectedCases:87,passedCases:87,skippedCases:0,sourceUnchanged:true,sourceHashes:Object.fromEntries(files.map(f=>[f,sha])),productionDatabaseVerified:false,committed:false,deployed:false};
   const s={productionConnected:false,schemaApplied:true,databaseConnected:true,database:"changmen_orders_phase2_test_v1",role:"changmen_orders_phase2_test",marker:"changmen:pm-gtc-orders:phase2:disposable:v1",address:"127.0.0.1"};
   expect(()=>assertPostgresEvidence(r,87,()=>Buffer.from("current"),s)).not.toThrow();
   if(mutant==="missing source")delete r.sourceHashes[files[0]];else if(mutant==="skipped test")r.skippedCases=1;else if(mutant==="wrong database")s.database="production";else if(mutant==="production verified")r.productionDatabaseVerified=true;
   expect(()=>assertPostgresEvidence(r,87,()=>Buffer.from(mutant==="stale source"?"changed":"current"),s)).toThrow();
 });
 it("accepts only the fixed legacy 64-case report format with checked local identity",()=>{
   const sha=createHash("sha256").update("current").digest("hex"),files=["scripts/migrations/pm-gtc-orders/phase2-schema.sql","scripts/migrations/pm-gtc-orders/integration/postgres.integration.mjs","server/db/rds/orders_execution_compat.js","server/db/rds/orders_store.js"];
   const r={databaseIntegrationAccepted:true,expectedCases:64,passedCases:64,skippedCases:0,sourceUnchanged:true,sourceHashes:Object.fromEntries(files.map(f=>[f,sha])),productionDatabaseVerified:false,committed:false,deployed:false};
   const s={schemaApplied:true,databaseConnected:true,database:"changmen_orders_phase2_test_v1",role:"changmen_orders_phase2_test",marker:"changmen:pm-gtc-orders:phase2:disposable:v1",address:"127.0.0.1"};
   expect(()=>assertPostgresEvidence(r,64,()=>Buffer.from("current"),s)).not.toThrow();
   expect(()=>assertPostgresEvidence(r,64,()=>Buffer.from("current"),{...s,productionConnected:true})).toThrow();
   expect(()=>assertPostgresEvidence(r,64,()=>Buffer.from("current"),{...s,address:"remote"})).toThrow();
   expect(()=>assertPostgresEvidence({...r,expectedCases:87,passedCases:87},87,()=>Buffer.from("current"),s)).toThrow();
 });
});
