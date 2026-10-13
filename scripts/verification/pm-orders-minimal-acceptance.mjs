// [changmen 扩展] 只接受保留全部尝试、来源未变的真实验收证据；不改原基线。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
export const objectDigest=value=>createHash("sha256").update(JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a],[b])=>a===b?0:a<b?-1:1)))).digest("hex");
export const phasesExpected=["capture","release-files","candidate-scope","fok-core","vps-core","public-entries","protection-negative","checks","router-compile","backend","order-business","compatibility","frontend-typecheck","frontend","build","node-tests","runtime-boundaries","release-stability"];
export function retryablePublicNetworkFailure(phase,log) {
  const text=log.replace(/\x1b\[[0-9;]*m/g,"");
  if(!/ECONNRESET|ETIMEDOUT/.test(text) || !/fetch failed|secure TLS connection|TLS connection/.test(text))return false;
  if(phase==="backend") {
    const failed=/FAIL\s+core\/integrations\/polymarket\/clob_proxy\.test\.mjs[^\n]*public GET \/time/.test(text);
    const failures=[...text.matchAll(/Failed:\s*([^\n]+)/g)].map(m=>m[1].trim());
    return failed && /Tests\s+1 failed\s*\|/.test(text) && failures.every(s=>s==="@changmen/backend#test") && /clob\.polymarket\.com/.test(text);
  }
  return ["capture","public-entries","release-stability"].includes(phase) && /changmen\.fun/.test(text);
}
export function assertReleaseEvidence(report,currentHashes) {
  assert.equal(report.passed,true,"release report failed");
  assert.equal(report.evidenceConsistent,true,"capture provenance inconsistent");
  assert.equal(report.inputUnchanged,true,"inputs changed during checks");
  assert.equal(report.inputDigest,objectDigest(currentHashes),"stale source evidence");
  assert.deepEqual(report.immutableBaselines,["219535c8","75b1efac66625e5f2bc9884a965b244bfaf337ed"]);
  assert.deepEqual(report.results.map(r=>r.phase),phasesExpected);
  for(const row of report.results) {
    assert.equal(row.passed,true,`failed phase: ${row.phase}`);
    assert(row.attempts?.length>=1 && row.attempts.length<=2,"bounded attempts required");
    assert.equal(row.attempts.at(-1).exitCode,0,"actual successful attempt required");
    if(row.attempts.length===2) {assert.equal(row.attempts[0].retryableNetworkFailure,true,"cannot exempt non-network failure");assert.equal(row.attempts[0].inputUnchanged,true,"cannot retry changed input");}
  }
  assert.equal(report.productionDatabaseConnected,false);assert.equal(report.productionWrites,false);
  assert.equal(report.committed,false);assert.equal(report.pushed,false);assert.equal(report.deployed,false);
}
export function assertPostgresEvidence(report,expected,readSource,server) {
  assert.equal(report.databaseIntegrationAccepted,true);assert.equal(report.expectedCases,expected);assert.equal(report.passedCases,expected);assert.equal(report.skippedCases,0);assert.equal(report.sourceUnchanged,true);
  const required=expected===87?["scripts/migrations/pm-orders-minimal/schema.sql","scripts/migrations/pm-orders-minimal/production-tools.mjs","scripts/migrations/pm-orders-minimal/production.mjs","scripts/migrations/pm-orders-minimal/postgres-tools-cases.mjs","server/db/rds/pm_orders_minimal.js"]:["scripts/migrations/pm-gtc-orders/phase2-schema.sql","scripts/migrations/pm-gtc-orders/integration/postgres.integration.mjs","server/db/rds/orders_execution_compat.js","server/db/rds/orders_store.js"];
  assert(required.every(file=>Object.hasOwn(report.sourceHashes??{},file)),"missing PostgreSQL source evidence");
  for(const [file,sha] of Object.entries(report.sourceHashes))assert.equal(createHash("sha256").update(readSource(file)).digest("hex"),sha,`stale PostgreSQL source: ${file}`);
  assert.equal(report.productionDatabaseVerified,false);assert.equal(report.committed,false);assert.equal(report.deployed,false);
  if(server) {
    // 原 64 项 server.json 尚无此字段；仅该固定旧格式可缺省，其本机身份仍逐项验证。
    if(expected!==64 || Object.hasOwn(server,"productionConnected"))assert.equal(server.productionConnected,false);
    assert.equal(server.schemaApplied,true);assert.equal(server.databaseConnected,true);assert.equal(server.database,"changmen_orders_phase2_test_v1");assert.equal(server.role,"changmen_orders_phase2_test");assert.equal(server.marker,"changmen:pm-gtc-orders:phase2:disposable:v1");assert(["127.0.0.1","::1"].includes(server.address));
  }
}
