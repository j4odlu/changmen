// [changmen 扩展] 固定已审查提交的完整撤销变换；原快照不变，当前模块不得包含其它修改。
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { gitSource, moduleTokens, replaceExact } from "./fok-exact-boundaries.mjs";
import { stripMinimalOrdersSource } from "./pm-orders-minimal-boundary.mjs";
export const retirementBase = "27d51b200889c962b7bc21f2733ecd895fa3a1e9";
export const retiredHelpers = ["server/db/rds/orders_execution_compat.js", "server/db/rds/pm_orders_minimal.js"];
export const nativeOrdersPath = "server/db/rds/native_orders.js";
let registered;
export function retirementFiles() {
  return registered ??= execFileSync("git", ["grep", "-l", "-E", "PM_ORDERS_MINIMAL|ORDERS_EXECUTION_COMPAT|orders_execution_compat|pm_orders_minimal|minimalClientOrder|pmOrdersMinimalEnabled", retirementBase, "--", "server", ":!*.test.*"], { encoding: "utf8" })
    .trim().split(/\r?\n/).map(line => line.slice(retirementBase.length + 1));
}
const oldRead = file => gitSource(retirementBase, file);
// Git/JS 把物理 CRLF 视为同一换行；不改变转义字符或 SQL 其它内容。
const sourceText = value => value.replaceAll("\r\n", "\n");
export function readRetiredHistoricalSource(file, readSource) {
  try { return readSource(file); }
  catch (error) { if (retiredHelpers.includes(file) && error.code === "ENOENT") return oldRead(file); throw error; }
}
export function nativeOrdersSource() {
  const tree = ts.createSourceFile("historical.js", oldRead(retiredHelpers[0]), ts.ScriptTarget.Latest, true);
  const fn = name => tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(tree);
  let relation = fn("financialOrdersRelation");
  relation = replaceExact(relation, 'const enabled = ordersExecutionCompatibilityEnabled();');
  relation = replaceExact(relation, 'const table = enabled ? "public.orders_financial" : "orders";', 'const table = "orders";');
  relation = replaceExact(relation, 'if (!alias && enabled) return `${table} AS orders`;');
  let hook = replaceExact(fn("financialOrdersHookRow"), "row = minimalHookRow(row);");
  hook = replaceExact(hook, '["execution_kind", "execution_id", "execution_wallet_key", "execution_active", "execution_record", "execution_updated_at", "financial_ready"]', '["pm_order_mode", "pm_order_snapshot", "execution_kind", "execution_id", "execution_wallet_key", "execution_active", "execution_record", "execution_updated_at", "financial_ready"]');
  hook = hook.replace("空扩展 schema、兼容尚未启用时 RETURNING * 也会多出 NULL 控制列。", "RETURNING * 可能包含历史内部列；通知只发送原业务字段。");
  return `/** [changmen 扩展] 原始订单表查询与通知字段清理；没有存储模式切换。 */\n${relation}\n${hook}\n`.replace(/[ \t]+$/gm, "");
}
export function removeGtcStorageModes(file, source) {
  if (retiredHelpers.includes(file)) return null;
  let text = stripMinimalOrdersSource(file, source, oldRead);
  const replace = (before, after = "") => { text = replaceExact(text, before, after); };
  const replaceText = (before, after = "") => { assert.equal(text.split(before).length, 2, `one complete SQL wrapper boundary: ${before}`); text = text.replace(before, after); };
  if (file === "server/backend/server.js") {
    replace('if (process.env.ORDERS_EXECUTION_COMPAT && process.env.ORDERS_EXECUTION_COMPAT !== "0") await ensurePgPoolReady();');
    replace("initLastWrittenIds, ensurePgPoolReady,", "initLastWrittenIds,");
  } else if (file === "server/db/pg_pool.js") {
    replace('import { prepareOrdersExecutionCompatibility } from "./rds/orders_execution_compat.js";');
    replace("  await prepareOrdersExecutionCompatibility(pool);\n");
  } else if (file === "server/db/index.js") {
    replace('export { financialOrdersRelation, prepareOrdersExecutionCompatibility } from "./rds/orders_execution_compat.js";', 'export { financialOrdersRelation } from "./rds/native_orders.js";');
  } else if (file === "server/db/rds/orders_store.js") {
    replace('import { DELETE_FINANCIAL_ORDERS_SQL, financialDeletionIds, financialOrdersHookRow, financialOrdersRelation, ordersExecutionCompatibilityEnabled, ordinaryOrdersUpsertSql } from "./orders_execution_compat.js";', 'import { financialOrdersHookRow, financialOrdersRelation } from "./native_orders.js";');
    replace("ordinaryOrdersUpsertSql(UPSERT_ORDERS_BATCH_SQL)", "UPSERT_ORDERS_BATCH_SQL");
    replace("ordersExecutionCompatibilityEnabled() ? financialDeletionIds(ids) : ids", "ids");
    replace('ordersExecutionCompatibilityEnabled() ? DELETE_FINANCIAL_ORDERS_SQL : "DELETE FROM orders WHERE id = ANY($1::bigint[])"', '"DELETE FROM orders WHERE id = ANY($1::bigint[])"');
    replaceText('${ordersExecutionCompatibilityEnabled() ? "AND o.financial_ready" : ""}');
  } else if (file === "server/db/rds/orderModes/gtc/pm_gtc_store.js") {
    replace('import { financialOrdersRelation, gtcFinancialUpsertSql } from "../../orders_execution_compat.js";', 'import { financialOrdersRelation } from "../../native_orders.js";');
    replaceText("client.query(gtcFinancialUpsertSql(`INSERT INTO orders", "client.query(`INSERT INTO orders");
    replaceText(" ELSE 0 END)`), [owner, row.plan.playerId", " ELSE 0 END)`, [owner, row.plan.playerId");
  } else if (file === "server/db/rds/orderModes/gtc/pm_gtc_orders_store.js") {
    replace('import { financialOrdersRelation, gtcExecutionLockSql, ordinaryOrdersUpsertSql } from "../../orders_execution_compat.js";', 'import { financialOrdersRelation } from "../../native_orders.js";');
    replaceText("return ordinaryOrdersUpsertSql(`", "return `");
    replaceText("`, true);", "`;");
    replace("gtcExecutionLockSql()", '"SELECT record FROM pm_gtc_executions WHERE id=$1 AND owner=$2 FOR SHARE"');
  } else if (file === "server/db/rds/orderModes/read.js") {
    replace('import { financialOrdersRelation } from "../orders_execution_compat.js";', 'import { financialOrdersRelation } from "../native_orders.js";');
  } else if (file === "server/db/rds/orderModes/gtc/pm_gtc_settlement.js") {
    replace('import { financialOrdersRelation } from "../../orders_execution_compat.js";', 'import { financialOrdersRelation } from "../../native_orders.js";');
  } else if (file.startsWith("server/backend/scripts/ops/")) {
    replace('import { financialOrdersRelation, prepareOrdersExecutionCompatibility } from "@changmen/db";', 'import { financialOrdersRelation } from "@changmen/db";');
    const matches = [...text.matchAll(/if \(process\.env\.ORDERS_EXECUTION_COMPAT === "1"\) await prepareOrdersExecutionCompatibility\((pool|c)\);/g)];
    assert.equal(matches.length, 1, "one complete retired pre-query validation"); replace(matches[0][0]);
  }
  assert(!/PM_ORDERS_MINIMAL|ORDERS_EXECUTION_COMPAT|orders_execution_compat|pm_orders_minimal|ordersExecutionCompatibilityEnabled|persistMinimalGtcOrder|prepareOrdersExecutionCompatibility|minimalClientOrder|pmOrdersMinimalEnabled/.test(text), `${file}: retired runtime wiring remains`);
  return text;
}
export function restoreRetiredOrdersCompatibility(file, source, readSource) {
  source = sourceText(source);
  if (!retirementFiles().includes(file) || retiredHelpers.includes(file)) return source;
  if (/PM_ORDERS_MINIMAL|ORDERS_EXECUTION_COMPAT|orders_execution_compat|pm_orders_minimal|minimalClientOrder|pmOrdersMinimalEnabled/.test(source)) return source;
  assert.deepEqual(moduleTokens(source), moduleTokens(removeGtcStorageModes(file, oldRead(file))), `${file}: complete native module after retirement`);
  if (readSource) assert.deepEqual(moduleTokens(sourceText(readSource(nativeOrdersPath))), moduleTokens(nativeOrdersSource()), "complete native orders helper");
  return oldRead(file);
}
export function verifyGtcCompatibilityRetirement(readSource = file => fs.readFileSync(file, "utf8")) {
  for (const file of retiredHelpers) assert(!fs.existsSync(file), `${file}: retired runtime helper must be absent`);
  assert.deepEqual(moduleTokens(sourceText(readSource(nativeOrdersPath))), moduleTokens(nativeOrdersSource()), "complete native orders helper");
  const files = retirementFiles().filter(file => !retiredHelpers.includes(file));
  for (const file of files) assert.deepEqual(moduleTokens(sourceText(readSource(file))), moduleTokens(removeGtcStorageModes(file, oldRead(file))), `${file}: complete native retirement boundary`);
  return { files: files.length, switchesRemoved: 3, nativeHelperVerified: true, fixedBefore: retirementBase };
}
