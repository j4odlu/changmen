// [changmen 扩展] 精确恢复本轮已审查的消费者接线，再比较完整原 FOK 模块。
// 固定原 FOK/VPS 基线不变；新增兼容 helper 全文单独保护，不按文件豁免。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const ordersCompatPath = "server/db/rds/orders_execution_compat.js";
export const ordersCompatDigest = "bfe79069c035b61970c73411877042bfac6aecc2b93891bce9acb3235cfa977d";

export function verifyOrdersCompatHelper(readSource) {
  const source = readSource(ordersCompatPath).replaceAll("\r\n", "\n");
  assert.equal(createHash("sha256").update(source).digest("hex"), ordersCompatDigest, "complete reviewed orders compatibility helper");
}

function once(source, before, after) {
  assert.equal(source.split(before).length, 2, `exact orders compatibility boundary: ${before}`);
  return source.replace(before, after);
}
export function restoreOrdersConsumerCompatibility(source, readSource) {
  verifyOrdersCompatHelper(readSource);
  source = once(source, "import { DELETE_FINANCIAL_ORDERS_SQL, financialDeletionIds, financialOrdersHookRow, financialOrdersRelation, ordersExecutionCompatibilityEnabled, ordinaryOrdersUpsertSql } from \"./orders_execution_compat.js\";\n", "");
  for (const [args, count, relation] of [["", 33, "orders"], ["\"o\"", 7, "orders o"], ["\"pm\"", 1, "orders pm"], ["\"other\"", 1, "orders other"]]) {
    const exact = `\${financialOrdersRelation(${args})}`;
    assert.equal(source.split(exact).length - 1, count, `fixed financial relation occurrences: ${args}`);
    source = source.replaceAll(exact, relation);
  }
  source = once(source, "client.query(ordinaryOrdersUpsertSql(UPSERT_ORDERS_BATCH_SQL),", "client.query(UPSERT_ORDERS_BATCH_SQL,");
  source = once(source, "inserted.push(financialOrdersHookRow(clean));", "inserted.push(clean);");
  source = once(source, "const clean = ordersExecutionCompatibilityEnabled() ? financialDeletionIds(ids) : ids", "const clean = ids");
  source = once(source, "pool.query(ordersExecutionCompatibilityEnabled() ? DELETE_FINANCIAL_ORDERS_SQL : \"DELETE FROM orders WHERE id = ANY($1::bigint[])\", [clean])", "pool.query(\"DELETE FROM orders WHERE id = ANY($1::bigint[])\", [clean])");
  // 原来这一个 SQL 使用普通字符串；值逐字保留，还原后全文 token 对比。
  source = once(source, "`SELECT * FROM orders WHERE user_id = $1 AND player_id = $2 ORDER BY create_at DESC`", "\"SELECT * FROM orders WHERE user_id = $1 AND player_id = $2 ORDER BY create_at DESC\"");
  return source;
}

export function restoreGtcOrdersCompatibility(file, source, readSource) {
  verifyOrdersCompatHelper(readSource);
  if (file === "server/db/rds/orderModes/gtc/pm_gtc_store.js") {
    source = once(source, "import { financialOrdersRelation, gtcFinancialUpsertSql } from \"../../orders_execution_compat.js\";\n", "");
    assert.equal(source.split(`\${financialOrdersRelation("o")}`).length, 2, "one reviewed legacy recovery financial relation");
    source = source.replaceAll(`\${financialOrdersRelation("o")}`, "orders o");
    source = once(source, `\${financialOrdersRelation()}`, "orders");
    source = once(source, "client.query(gtcFinancialUpsertSql(`INSERT INTO orders", "client.query(`INSERT INTO orders");
    return once(source, " ELSE 0 END)`), [owner, row.plan.playerId", " ELSE 0 END)`, [owner, row.plan.playerId");
  }
  assert.equal(file, "server/db/rds/orderModes/gtc/pm_gtc_orders_store.js", "only two reviewed GTC persistence boundaries");
  source = once(source, "import { financialOrdersRelation, gtcExecutionLockSql, ordinaryOrdersUpsertSql } from \"../../orders_execution_compat.js\";\n", "");
  source = once(source, "function ordersUpsertSql() {\n  return ordinaryOrdersUpsertSql(`", "const UPSERT_ORDERS_BATCH_SQL = `");
  source = once(source, "`, true);\n}\n\nfunction _orderRowToUpsertArrays", "`;\n\nfunction _orderRowToUpsertArrays");
  assert.equal(source.split(`\${financialOrdersRelation("canonical")}`).length, 3);
  source = source.replaceAll(`\${financialOrdersRelation("canonical")}`, "orders canonical");
  source = once(source, `\${financialOrdersRelation()}`, "orders");
  source = once(source, "client.query(gtcExecutionLockSql(),", "client.query(\"SELECT record FROM pm_gtc_executions WHERE id=$1 AND owner=$2 FOR SHARE\",");
  return once(source, "client.query(ordersUpsertSql(),", "client.query(UPSERT_ORDERS_BATCH_SQL,");
}
