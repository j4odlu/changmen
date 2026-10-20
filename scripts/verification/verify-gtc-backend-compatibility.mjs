import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
// [changmen 扩展] 执行状态只在客户端；真实结果同步、历史读取及独立发布组合均须有执行证据。
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import assert from "node:assert/strict";
import { confirmedResultSyncScenario, exactMonitorApiScenario, legacyBackendScenario, loadOfflineModule } from "./gtc-legacy-backend-fixture.mjs";
import { releasePlan, selectGtcRelease, verifyLegacyGtcBackendModules } from "./gtc-independent-release.mjs";
import { publicFiles, verifyActualPublicModule } from "./public-release-boundaries.mjs";
import { verifyGtcClientStateSources } from "./gtc-client-state-boundary.mjs";
const plan = releasePlan(process.argv.slice(2));
const snapshot = JSON.parse(readAdapterHistory("output/vps-fok-baseline.json", "utf8"));
const source = withAdapterHistoryReader(file => readAdapterHistory(file, "utf8")), captured = file => snapshot.sources[file];
const onlineSource = file => file.startsWith("server/") ? captured(file) : source(file);
const route = "server/backend/core/esport-api/pm_pf_routes.ts";
verifyGtcClientStateSources(source);
for (const file of publicFiles) verifyActualPublicModule(file, source(file), captured(file));
verifyLegacyGtcBackendModules(source, captured);

// 新版执行写入必须明确拒绝，且拒绝之前不能调用任何存储或交易依赖。
async function retiredControlScenario() {
  const file = "server/backend/core/orderModes/gtc/handler.js", calls = [];
  const handler = loadOfflineModule(file, source(file), () => new Proxy({}, { get: (_, key) => () => {
    calls.push(String(key)); throw new Error("unexpected control dependency");
  } }));
  for (const action of ["Pm_GtcCreate", "Pm_GtcCommand"]) {
    await assert.rejects(() => handler.handlePmGtc(action, { command: { kind: "not_sent", leg: "PM" } }, "owner"), /执行控制已迁移至客户端/);
  }
  assert.equal(calls.length, 0);
  return { passed: true, writesRejected: ["Pm_GtcCreate", "Pm_GtcCommand"], dependencyCalls: calls.length };
}
const retiredControl = await retiredControlScenario();
const legacyProof = [];
for (const [name, options] of [["repeated-enriched-pages", { repeatedGroup: true }], ["late-fill-original-date", { lateFill: true }]]) {
  const before = await legacyBackendScenario(captured, options), after = await legacyBackendScenario(source, options);
  assert.equal(before.error, undefined, name); assert.equal(after.error, undefined, name);
  assert.equal(JSON.stringify(after.restored), JSON.stringify(before.restored), `Existing GTC read/DTO contract: ${name}`);
  legacyProof.push({ name, passed: true });
}
const rebound = await legacyBackendScenario(captured, { rebound: true });
assert.match(rebound.error, /跨日期改绑/);
const exact = [], onlineExact = [];
const supportsResults = ['"Pm_GtcSyncResult"', '"Pm_GtcReadResults"'].every(action => captured(route).includes(action));
for (const status of ["Win", "Lose", "Return", "Reject"]) {
  const raw = { ...rebound.ledgerRaw, status };
  const restored = await exactMonitorApiScenario(rebound.record, [raw]);
  assert.equal(restored.error, undefined); assert.equal(restored.rows.length, 1);
  assert.equal(restored.rows[0].Status, status); assert.equal(restored.rows[0].Link, raw.link);
  assert.deepEqual(restored.trace.filter(row => row.action).map(row => row.action), ["Pm_GtcReadResults"]);
  assert.equal(restored.trace.some(row => row.read === "executions"), false, "RDS is not the execution authority");
  const online = await exactMonitorApiScenario(rebound.record, [raw], { backendSource: captured });
  if (supportsResults) { assert.equal(online.error, undefined); assert.equal(JSON.stringify(online.rows), JSON.stringify(restored.rows)); }
  else { assert.match(online.error, /Pm_GtcReadResults/); assert.equal(online.rows, undefined); }
  exact.push({ name: `rebound-settled-${status}`, passed: true });
  onlineExact.push({ name: `rebound-settled-${status}`, passed: !online.error, error: online.error });
}
for (const [name, rows, options] of [["missing-acknowledged-original", [], {}], ["database-failure", [rebound.ledgerRaw], { failRead: true }], ["session-changed", [rebound.ledgerRaw], { changeSession: true }]]) {
  for (const read of supportsResults ? [source, captured] : [source]) {
    const failure = await exactMonitorApiScenario(rebound.record, rows, { ...options, backendSource: read });
    assert(failure.error && !failure.rows, name);
    assert.equal(failure.trace.filter(row => row.action).length, 1, "No fallback after a supported exact query failed");
  }
  exact.push({ name, passed: true });
}
const pending = await exactMonitorApiScenario(rebound.record, [], { resultPending: true });
assert.equal(pending.error, undefined); assert.equal(pending.rows.length, 0);
exact.push({ name: "missing-original-waits-only-for-durable-result-outbox", passed: true });

const synced = await confirmedResultSyncScenario(source);
assert.deepEqual(synced.trace, [{ action: "Pm_GtcSyncResult" }, { save: "confirmed-result" }, { finish: "acknowledged" }]);
assert.deepEqual(synced.issues, {});
const resultProof = [{ name: "confirmed-six-decimal-partial-fill", passed: true }];
for (const fault of ["process", "intermediate", "financial", "owner", "ack"]) {
  const failure = await confirmedResultSyncScenario(source, { fault });
  assert.equal(failure.trace.at(-1).finish, "retry", fault);
  assert.equal(failure.trace.some(row => row.finish === "acknowledged"), false, fault);
  if (fault !== "ack") assert.equal(failure.trace.some(row => row.save), false, fault);
  assert.equal(Object.keys(failure.issues).length, 1, fault);
  resultProof.push({ name: `reject-and-retain-${fault}`, passed: true });
}
const onlineSync = await confirmedResultSyncScenario(onlineSource);
if (supportsResults) assert.deepEqual(onlineSync.trace, synced.trace);
else { assert.equal(onlineSync.trace.at(-1).finish, "retry"); assert.equal(onlineSync.trace.some(row => row.save), false); }
const frontendFailed = [...onlineExact.filter(row => !row.passed).map(row => `gtc:${row.name}`),
  ...(onlineSync.trace.at(-1).finish === "acknowledged" ? [] : ["gtc:confirmed-result-sync-unsupported"])];
const combinations = [
  { id: "frontend-only", frontend: "candidate", backend: snapshot.backendVersion, passed: frontendFailed.length === 0, failedBoundaries: frontendFailed, evidence: { exactReads: onlineExact, syncTrace: onlineSync.trace } },
  { id: "backend-only", frontend: snapshot.frontendVersion, backend: "candidate", passed: legacyProof.every(row => row.passed) && retiredControl.passed, failedBoundaries: [],
    evidence: { completePublicModulesPreserved: true, completeLegacyGtcReadsPreserved: true, legacyReadContract: legacyProof, retiredControl },
    deploymentConstraint: "Legacy GTC execution writes are intentionally retired. Deploy only with no active legacy GTC users/orders; refresh clients before using GTC. Existing ordinary betting/FOK and historical reads remain protected." },
  { id: "paired", frontend: "candidate", backend: "candidate", passed: [...exact, ...resultProof].every(row => row.passed), failedBoundaries: [], evidence: { exact, resultProof, syncTrace: synced.trace, retiredControl } },
];
const release = selectGtcRelease(plan, combinations);
const report = { captureId: snapshot.captureId, frontendVersion: snapshot.frontendVersion, backendVersion: snapshot.backendVersion, immutableBaseline: snapshot.immutableBaseline,
  combinations, release, frontendOnlyGtcCompatible: release.frontendOnlyGtcCompatible, passed: release.passed,
  scope: "Actual current sync consumer/action/handler/result validation and exact read/DTO; complete protected sources and legacy read contracts checked. Local queue and database boundaries mocked, no live mutations. Backend-first requires no active legacy GTC use and client refresh; legacy execution writes are not compatible." };
fs.writeFileSync("output/gtc-backend-compatibility.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
if (!report.passed) process.exitCode = 1;
