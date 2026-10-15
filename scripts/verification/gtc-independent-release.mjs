// [changmen 扩展] 显式核验独立发布组合；默认仍拒绝不兼容的前端单独发布。
import assert from "node:assert/strict";
import ts from "typescript";
import { gitSource, moduleTokens, replaceExact } from "./fok-exact-boundaries.mjs";
import { verifyGtcClientStateSource } from "./gtc-client-state-boundary.mjs";

export function releasePlan(args) {
  assert(args.length === 0 || (args.length === 1 && ["--release-plan=frontend-only", "--release-plan=backend-first"].includes(args[0])), "Unknown or conflicting release plan");
  return args[0]?.split("=")[1] ?? "frontend-only";
}

export function selectGtcRelease(plan, combinations) {
  assert(["frontend-only", "backend-first"].includes(plan), "Unknown release plan");
  assert.equal(combinations.length, 3, "All independent release combinations are required");
  const ids = ["frontend-only", "backend-only", "paired"];
  const rows = new Map(combinations.map(row => [row.id, row]));
  assert.equal(rows.size, 3, "Duplicate release combinations");
  for (const id of ids) {
    const row = rows.get(id);
    assert(row && typeof row.passed === "boolean" && Array.isArray(row.failedBoundaries), `Missing evidence: ${id}`);
    assert.equal(row.passed, row.failedBoundaries.length === 0, `Inconsistent evidence: ${id}`);
  }
  const required = plan === "backend-first" ? ["backend-only", "paired"] : ["frontend-only"];
  return { plan, passed: required.every(id => rows.get(id).passed),
    frontendOnlyGtcCompatible: rows.get("frontend-only").passed,
    requiredCombinations: required, deploymentOrder: plan === "backend-first" ? ["backend", "frontend"] : ["frontend"],
    failedBoundaries: required.flatMap(id => rows.get(id).failedBoundaries),
    blockedCombinations: combinations.filter(row => !row.passed).map(row => row.id) };
}

/** 逐模块核验历史读取与旧存储分支；客户端分工增量先核对完整固定指纹，再还原比较。 */
export function verifyLegacyGtcBackendModules(source, captured) {
  const handler = "server/backend/core/orderModes/gtc/handler.js";
  // [changmen 扩展] 两端分别核对已登记扩展，再比较原契约；线上已升级时不能只还原候选一端。
  const normalizeHandler = read => {
    let specialized = read(handler);
    // [changmen 扩展] 新版只读兼容旧历史，旧写命令明确拒绝。完整新模块须先通过固定源码登记。
    if (specialized.includes('"Pm_GtcSyncResult"')) {
      for (const file of [handler, "server/backend/core/orderModes/gtc/results.js"])
        verifyGtcClientStateSource(file, read(file));
      return normalizeHandler(file => file === handler ? gitSource("3a88e886ad897d0bf06ee81c2aa761f7ae194738", file) : read(file));
    }
    // [changmen 扩展] 只登记明确未发送的新增命令，原命令顺序、授权与 handler 全文继续核对。
    if (specialized.includes('"not_sent"')) {
      specialized = replaceExact(specialized,
        '["authorize_pm", "authorize_other", "ack", "other", "not_sent", "facts", "close", "cancel", "cancel_result", "resume", "counted"]',
        '["authorize_pm", "authorize_other", "ack", "other", "facts", "close", "cancel", "cancel_result", "resume", "counted"]');
    }
    if (specialized.includes('"Pm_GtcRecover"')) {
      assert.deepEqual(moduleTokens(specialized), moduleTokens(gitSource("adb333bf24b6ba6aa3e441009b56f874a23f6ed9", handler)), "complete committed recovery handler");
      specialized = replaceExact(specialized, 'import { recoverPmGtc } from "./recovery.js";');
      specialized = replaceExact(specialized, 'if (action === "Pm_GtcRecover") return recoverPmGtc(body, owner);');
      const recovery="server/backend/core/orderModes/gtc/recovery.js";
      let recoverySource = read(recovery);
      if (recoverySource.includes('gtcPmNeverSubmitted')) {
        recoverySource = replaceExact(recoverySource, 'import { gtcPmNeverSubmitted, gtcUnits } from "@changmen/shared/pm_gtc";', 'import { gtcUnits } from "@changmen/shared/pm_gtc";');
        recoverySource = replaceExact(recoverySource,
          'const pmMayExist = !gtcPmNeverSubmitted(row) && (row.pmAuthorized || row.orderId || !["prepared", "not_attempted"].includes(row.submit)) || Number(row.financialOrder?.pmShares) > 0;',
          'const pmMayExist = row.pmAuthorized || row.orderId || !["prepared", "not_attempted"].includes(row.submit) || Number(row.financialOrder?.pmShares) > 0;');
      }
      assert.deepEqual(moduleTokens(recoverySource),moduleTokens(gitSource("adb333bf24b6ba6aa3e441009b56f874a23f6ed9",recovery)),"complete committed unified recovery module");
      specialized = replaceExact(specialized, `if (body.knownRevisions != null) {
        let known;
        try { known = parse(body.knownRevisions); }
        catch { throw new Error("GTC 已知版本无效"); }
        if (!known || typeof known !== "object" || Array.isArray(known) || Object.keys(known).length > 1000
          || Object.entries(known).some(([id, revision]) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
            || !Number.isSafeInteger(revision) || revision < 0)) {
          throw new Error("GTC 已知版本无效");
        }
        return listPmGtc(owner, undefined, known);
      }`);
    }
    if (specialized.includes('"Pm_GtcMonitorOrders"')) {
      specialized = replaceExact(specialized, 'import { getGtcMonitorOrders, getGtcOrders, saveGtcOrders } from "./orders.js";', 'import { getGtcOrders, saveGtcOrders } from "./orders.js";');
      specialized = replaceExact(specialized, 'if (action === "Pm_GtcMonitorOrders") return getGtcMonitorOrders(body, owner);');
    }
    return specialized;
  };
  assert.deepEqual(moduleTokens(normalizeHandler(source)), moduleTokens(normalizeHandler(captured)), "complete legacy GTC handler");
  const orders = "server/backend/core/orderModes/gtc/orders.js";
  const parse = text => ts.createSourceFile(orders, text, ts.ScriptTarget.Latest, true);
  const normalizeOrders = read => {
    const text = read(orders);
    if (!text.includes('if (body.origins != null)')) return text;
    verifyGtcClientStateSource(orders, text);
    verifyGtcClientStateSource("server/backend/core/orderModes/gtc/results.js", read("server/backend/core/orderModes/gtc/results.js"));
    return gitSource("3a88e886ad897d0bf06ee81c2aa761f7ae194738", orders);
  };
  const current = parse(normalizeOrders(source)), previous = parse(normalizeOrders(captured));
  const added = current.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === "getGtcMonitorOrders");
  assert.equal(added.length, 1, "Exactly one GTC monitor function is required");
  const reviewed = parse(gitSource("adb333bf24b6ba6aa3e441009b56f874a23f6ed9",orders));
  const monitor = reviewed.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==="getGtcMonitorOrders");
  assert.deepEqual(moduleTokens(added[0].getText(current)),moduleTokens(monitor.getText(reviewed)),"complete committed exact GTC monitor function");
  const previousAdded = previous.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === "getGtcMonitorOrders");
  assert(previousAdded.length <= 1, "At most one captured GTC monitor function is allowed");
  if (previousAdded.length) assert.deepEqual(moduleTokens(previousAdded[0].getText(previous)), moduleTokens(monitor.getText(reviewed)), "complete captured exact GTC monitor function");
  const imports = tree => tree.statements.filter(ts.isImportDeclaration).map(node => node.getText(tree));
  const extraImport = 'import { toClientOrder } from "../../account/order/dto.js";';
  assert.equal(imports(current).filter(text => text === extraImport).length, 1);
  const tokenized = items => items.map(text => JSON.stringify(moduleTokens(text))).sort();
  assert.deepEqual(tokenized(imports(current).filter(text => imports(previous).includes(extraImport) || text !== extraImport)), tokenized(imports(previous)), "complete legacy GTC imports");
  const body = tree => tree.statements.filter(node => !ts.isImportDeclaration(node) && !(ts.isFunctionDeclaration(node) && node.name?.text === "getGtcMonitorOrders"))
    .map(node => node.getText(tree)).join("\n");
  assert.deepEqual(moduleTokens(body(current)), moduleTokens(body(previous)), "complete legacy GTC orders module");
  return true;
}
