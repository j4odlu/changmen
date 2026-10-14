// [changmen 扩展] 仅撤销精确新增接线，随后仍比较完整原 FOK/VPS 模块。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { restoreRetiredOrdersCompatibility, readRetiredHistoricalSource } from "./gtc-compat-retirement.mjs";
export const minimalPath="server/db/rds/pm_orders_minimal.js";
export const minimalDigest="f355afb41dd4ec4b575852dcacb382072b66d1ecead2b553e7f250dcd42621e5";
function once(s,a,b=""){assert.equal(s.split(a).length,2,`exact minimal orders boundary: ${a}`);return s.replace(a,b);}
export function restoreMinimalOrdersSource(file,input,readSource){
 return stripMinimalOrdersSource(file,restoreRetiredOrdersCompatibility(file,input,readSource),path=>readRetiredHistoricalSource(path,readSource));
}
export function stripMinimalOrdersSource(file,input,readSource){
 let s=input.replaceAll("\r\n","\n");
 const marker={
  "server/db/rds/orders_execution_compat.js":"import { minimalFinancialSql, minimalHookRow, pmOrdersMinimalEnabled, preparePmOrdersMinimal }",
  "server/db/rds/orders_store.js":"import { minimalFinancialDeletionSql }",
  "server/db/rds/orderModes/gtc/pm_gtc_store.js":"import { persistMinimalGtcOrder }",
  "server/backend/core/account/order_store.js":"if (sb.pmOrdersMinimalEnabled())",
  "server/backend/core/account/order/dto.js":"minimalClientOrder",
  "server/db/index.js":"./rds/pm_orders_minimal.js",
  "server/db/rds/orderModes/read.js":"import { pmOrdersMinimalEnabled }",
  "server/backend/core/integrations/polymarket/clob_proxy.test.mjs":"}, 65_000)",
 }[file];
 if(!marker||!s.includes(marker))return s;
 assert.equal(createHash("sha256").update(readSource(minimalPath).replaceAll("\r\n","\n")).digest("hex"),minimalDigest,"complete reviewed minimal GTC order module");
 if(file==="server/backend/core/integrations/polymarket/clob_proxy.test.mjs"){
  return once(s,'    expect(Number(result.text.trim())).toBeGreaterThan(0);\n  }, 65_000);','    expect(Number(result.text.trim())).toBeGreaterThan(0);\n  });');
 }else if(file==="server/db/rds/orders_store.js"){
  s=once(s,'import { minimalFinancialDeletionSql } from "./pm_orders_minimal.js";\n');
  s=once(s,'minimalFinancialDeletionSql(DELETE_FINANCIAL_ORDERS_SQL)','DELETE_FINANCIAL_ORDERS_SQL');
 }else if(file==="server/db/rds/orders_execution_compat.js"){
  s=once(s,'import { minimalFinancialSql, minimalHookRow, pmOrdersMinimalEnabled, preparePmOrdersMinimal } from "./pm_orders_minimal.js";\n');
  s=once(s,'  if (pmOrdersMinimalEnabled()) return true;\n');
  s=once(s,'  await preparePmOrdersMinimal(pool);\n');
  s=once(s,'  row = minimalHookRow(row);\n');
  s=once(s,'  if (pmOrdersMinimalEnabled()) return "SELECT record FROM pm_gtc_executions WHERE id=$1 AND owner=$2 FOR SHARE";\n');
  s=once(s,'  const result = prefix + sql.replace(conflict, `${conflict}\\n        financial_ready=true,\\n        ${promotion}`);\n  return pmOrdersMinimalEnabled() ? minimalFinancialSql(result) : result;',
   '  return prefix + sql.replace(conflict, `${conflict}\\n        financial_ready=true,\\n        ${promotion}`);');
 }else if(file==="server/db/rds/orderModes/gtc/pm_gtc_store.js"){
  s=once(s,'import { persistMinimalGtcOrder } from "../../pm_orders_minimal.js";\n');
  s=once(s,'    if (row.decision === "closed" && command.kind === "facts")\n      await persistMinimalGtcOrder(client, row);\n');
 }else if(file==="server/backend/core/account/order_store.js"){
  s=once(s,'  if (sb.pmOrdersMinimalEnabled()) {\n    const result = await sb.fetchMinimalOrderListPage(target, userId, page, size);\n    const visible = await enrichOrdersBelongingToDate(result.rows, target, { userId });\n    return { list: await attachPlayerDisplayToClientOrders(visible.map(toClientOrder)), total: result.total };\n  }\n');
 }else if(file==="server/backend/core/account/order/dto.js"){
  s=once(s,'import { minimalClientOrder, placeholderLinkFromCreateAt }','import { placeholderLinkFromCreateAt }');
  s=once(s,'return minimalClientOrder(r, scrubClientOrder(rowToOrder(r)));','return scrubClientOrder(rowToOrder(r));');
 }else if(file==="server/db/rds/orderModes/read.js"){
  s=once(s,'import { pmOrdersMinimalEnabled } from "../pm_orders_minimal.js";\n');
  s=once(s,'  const matchByMode = pmOrdersMinimalEnabled() ? "(provider=\'Polymarket\' AND pm_order_mode=\'GTC\') OR " + match : match;\n');
  s=once(s,'(${matchByMode})','(${match})');
  s=once(s,'  const relation = pmOrdersMinimalEnabled() && mode === "GTC" ? "orders" : financialOrdersRelation();\n');
  assert.equal(s.split('${relation}').length,3,"exactly two list relations");
  s=s.replaceAll('${relation}','${financialOrdersRelation()}');
 }else{
  s=once(s,'export { fetchMinimalOrderListPage, minimalClientOrder, pmOrdersMinimalEnabled } from "./rds/pm_orders_minimal.js";\n');
 }
 return s;
}
