// [changmen 扩展] 当前真实恢复 API 配对新鲜捕获的线上 action 路由；只模拟 GTC 数据读取。
import fs from "node:fs";
import assert from "node:assert/strict";
import vm from "node:vm";
import ts from "typescript";
import { exactMonitorApiScenario, legacyBackendScenario } from "./gtc-legacy-backend-fixture.mjs";
import { releasePlan, selectGtcRelease, verifyLegacyGtcBackendModules } from "./gtc-independent-release.mjs";
import { publicFiles, verifyActualPublicModule } from "./public-release-boundaries.mjs";
const plan = releasePlan(process.argv.slice(2));
const snapshot = JSON.parse(fs.readFileSync("output/vps-fok-baseline.json", "utf8"));
const route = "server/backend/core/esport-api/pm_pf_routes.ts", api = "client/web/src/orderModes/gtc/ordersApi.ts";
function load(file, source, require) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, module: { exports }, require, console, Error, Date, Map, Set, Number, JSON }, { filename: file });
  return exports;
}
const id = "11111111-1111-1111-1111-111111111111", at = Date.UTC(2026, 9, 8, 23, 59);
const original = { PlayerID: 1, Type: "Polymarket", OrderID: "buy", Status: "Win", PmGtcExecutionId: id };
async function scenario(captured, fault = "") {
  const events = [];
  const backend = load(route, captured ? snapshot.sources[route] : fs.readFileSync(route, "utf8"), () => new Proxy({
    handlePmGtc: async (action, body, owner) => {
      assert.equal(owner, "owner"); events.push({ action, body, owner });
      if (action === "Pm_GtcMonitorOrders") return [original];
      if (action === "Pm_GtcList") return [{ id, owner, createdAt: at, plan: { playerId: 1, orderHash: "BUY", linkId: at }, other: { orderId: null, submittedAt: 0 } }];
      assert.equal(action, "Pm_GtcOrders", "Compatibility cannot call trading or ordinary order handlers");
      if (fault === "database") throw new Error("database unavailable");
      return { list: body.pageIndex === 1 ? [{ ...original, ...(fault === "identity" ? { PmGtcExecutionId: "other" } : {}) }, { ...original, PlayerID: 99 }] : [], pageIndex: body.pageIndex, pageSize: body.pageSize };
    },
  }, { get(object, key) { return key in object ? object[key] : () => { throw new Error("unexpected backend action: " + String(key)); }; } }));
  const client = load(api, fs.readFileSync(api, "utf8"), name => name === "@/api/client" ? {
    getAuthSessionVersion: () => "session", isAuthSessionCurrent: () => true,
    post: async (action, body) => { events.push({ post: action }); return backend.handlePmPfAction(action, body, { user: { id: "owner" } }); },
    unwrap: response => { if (response.success !== 1) throw new Error(response.msg); return response.info; },
  } : {});
  let rows, error;
  try { rows = await client.loadGtcMonitorOrders([id]); } catch (e) { error = String(e.message); }
  return { capturedBackend: captured, fault, events, rows, error, compatible: !error };
}
const online = await scenario(true), current = await scenario(false);
const unknownAction = !snapshot.sources[route].includes('"Pm_GtcMonitorOrders"');
assert(current.compatible); assert.equal(online.compatible, !unknownAction);
if (!unknownAction) assert.equal(JSON.stringify(online.rows), JSON.stringify([original]));
else assert.match(online.error, /Pm_GtcMonitorOrders/);
assert.equal(JSON.stringify(current.rows), JSON.stringify([original]));
assert.equal(online.events.filter(row => row.post).length, 1);
assert.equal(online.events.some(row => row.action === "Pm_GtcList"), false);
for (const fault of ["database", "identity"]) {
  if (unknownAction) assert.equal((await scenario(true, fault)).compatible, false, `Legacy failure must propagate: ${fault}`);
}
const business = [];
const source = file => fs.readFileSync(file, "utf8"), captured = file => snapshot.sources[file];
for (const file of publicFiles) verifyActualPublicModule(file, source(file), captured(file));
verifyLegacyGtcBackendModules(source, captured);
const legacyProof = [];
for (const [name, options] of [["repeated-enriched-pages", { repeatedGroup: true }], ["late-fill-original-date", { lateFill: true }]]) {
  const before = await legacyBackendScenario(captured, options), after = await legacyBackendScenario(source, options);
  assert.equal(before.error, undefined, name); assert.equal(after.error, undefined, name);
  assert.equal(JSON.stringify(after.restored), JSON.stringify(before.restored), `Existing GTC read/DTO contract: ${name}`);
  legacyProof.push({ name, passed: true });
}
const rebound = await legacyBackendScenario(captured, { rebound: true });
if (unknownAction) {
  for (const [name, options] of [["repeated-enriched-pages", { repeatedGroup: true }], ["late-fill-original-date", { lateFill: true }]]) {
    const evidence = await legacyBackendScenario(file => snapshot.sources[file], options);
    assert.equal(evidence.error, undefined, name); assert.equal(evidence.restored.length, 1, name);
    business.push({ name, passed: true });
  }
  assert.match(rebound.error, /跨日期改绑/);
  business.push({ name: "monitor-endpoint-required", passed: false, failClosed: true, currentModernBackendPasses: true, error: online.error });
}
const exact = [];
for (const status of ["Win", "Lose", "Return", "Reject"]) {
  const raw = { ...rebound.ledgerRaw, status };
  const restored = await exactMonitorApiScenario(rebound.record, [raw]);
  assert.equal(restored.error, undefined); assert.equal(restored.rows.length, 1);
  assert.equal(restored.rows[0].Status, status); assert.equal(restored.rows[0].Link, raw.link);
  assert.equal(JSON.stringify(restored.trace.filter(row => row.action).map(row => row.action)), JSON.stringify(["Pm_GtcMonitorOrders"]));
  if (!unknownAction) {
    const onlineExact = await exactMonitorApiScenario(rebound.record, [raw], { backendSource: captured });
    assert.equal(onlineExact.error, undefined); assert.equal(JSON.stringify(onlineExact.rows), JSON.stringify(restored.rows));
  }
  exact.push({ name: `rebound-settled-${status}`, passed: true });
}
for (const [name, rows, options] of [["missing-filled-original", [], {}], ["database-failure", [rebound.ledgerRaw], { failRead: true }], ["session-changed", [rebound.ledgerRaw], { changeSession: true }]]) {
  const failure = await exactMonitorApiScenario(rebound.record, rows, options);
  assert(failure.error && !failure.rows, name);
  assert.equal(failure.trace.filter(row => row.action).length, 1, "No fallback after a supported exact query failed");
  exact.push({ name, passed: true });
}
const combinations = [
  { id: "frontend-only", frontend: "candidate", backend: snapshot.backendVersion, passed: business.every(row => row.passed), failedBoundaries: business.filter(row => !row.passed).map(row => `gtc:${row.name}`) },
  { id: "backend-only", frontend: snapshot.frontendVersion, backend: "candidate", passed: true, failedBoundaries: [], evidence: { completePublicModulesPreserved: true, completeLegacyGtcModulesPreserved: true, legacyReadContract: legacyProof } },
  { id: "paired", frontend: "candidate", backend: "candidate", passed: true, failedBoundaries: [], evidence: exact },
];
const release = selectGtcRelease(plan, combinations);
const report = { captureId: snapshot.captureId, frontendVersion: snapshot.frontendVersion, backendVersion: snapshot.backendVersion, immutableBaseline: snapshot.immutableBaseline, oldBackendRequiredFallback: unknownAction, online, current, business,
  combinations, release, frontendOnlyGtcCompatible: release.frontendOnlyGtcCompatible, passed: release.passed,
  scope: "Explicit independent release combinations; captured route and legacy read/enrich/date/DTO/identity functions; current real frontend/action/handler/exact query/DTO; database reads mocked; no live mutation. The selected plan and required combinations determine acceptance." };
fs.writeFileSync("output/gtc-backend-compatibility.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, online: { basicRouteReadCompatible: true }, current: { exactHandlerCompatible: true } }));
if (!report.passed) process.exitCode = 1;
