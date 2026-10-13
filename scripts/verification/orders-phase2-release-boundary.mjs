// [changmen 扩展] 第二阶段独立包：保留固定历史基线，并全文核对实际已发布模块。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { restoreOrdersConsumerCompatibility, restoreGtcOrdersCompatibility, verifyOrdersCompatHelper } from './orders-consumer-boundary.mjs';
import { restoreMinimalOrdersSource } from './pm-orders-minimal-boundary.mjs';

export const deployedSource = '113db6ff4e59dd615f8dd867e11d859b05766b7d';
export const immutableBaselines = ['219535c8','75b1efac66625e5f2bc9884a965b244bfaf337ed'];
export const read = file => fs.readFileSync(file,'utf8').replaceAll('\r\n','\n');
export const gitSource = (base,file) => execFileSync('git',['show',`${base}:${file}`],{encoding:'utf8',maxBuffer:8*1024*1024});
export function moduleTokens(source) {
  const tree=ts.createSourceFile('module.ts',source,ts.ScriptTarget.Latest,true);
  assert.equal(tree.parseDiagnostics.length,0);
  const result=[];
  function visit(node) {
    if(ts.isJSDoc(node)) return;
    const children=node.getChildren(tree);
    if(children.length) children.forEach(visit);
    else if(node.getWidth(tree)>0) result.push([ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)?'literal':node.kind,ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)?node.text:node.getText(tree)]);
  }
  visit(tree);return result;
}
export function verifyProtectedSource(file,current,original,readSource=read) {
  assert.equal(file,'server/db/rds/orders_store.js');
  assert.deepEqual(moduleTokens(restoreOrdersConsumerCompatibility(current,readSource)),moduleTokens(original),'complete original orders module after exact compatibility wiring');
  return {exactBoundaryVerified:true};
}
function once(source,before,after='') { assert.equal(source.split(before).length,2,`exact phase2 wiring: ${before}`);return source.replace(before,after); }
export function restorePhase2Module(file,source,readSource=read) {
  source=restoreMinimalOrdersSource(file,source,readSource);
  verifyOrdersCompatHelper(readSource);
  if(file==='server/db/rds/orders_store.js') return restoreOrdersConsumerCompatibility(source,readSource);
  if(['server/db/rds/orderModes/gtc/pm_gtc_store.js','server/db/rds/orderModes/gtc/pm_gtc_orders_store.js'].includes(file)) return restoreGtcOrdersCompatibility(file,source,readSource);
  if(file==='server/db/pg_pool.js') {
    source=once(source,'import { prepareOrdersExecutionCompatibility } from "./rds/orders_execution_compat.js";\n');
    return once(source,'  const pool = getPgPool();\n  await prepareOrdersExecutionCompatibility(pool);\n  return pool;','  return getPgPool();');
  }
  if(file==='server/db/index.js') return once(source,'export { financialOrdersRelation, prepareOrdersExecutionCompatibility } from "./rds/orders_execution_compat.js";\n');
  if(file==='server/backend/server.js') {
    source=once(source,'  ensurePgPoolReady,\n');
    return once(source,'// [changmen 扩展] 仅显式启用并表兼容时，监听与后台任务开始前验证；无自动 DDL。\nif (process.env.ORDERS_EXECUTION_COMPAT && process.env.ORDERS_EXECUTION_COMPAT !== "0")\n  await ensurePgPoolReady();\n\n');
  }
  if(file==='server/backend/core/account/admin_maintenance.js') source=once(source,'import { ensurePgPoolReady, financialOrdersRelation, getPgPool } from "@changmen/db";','import { ensurePgPoolReady, getPgPool } from "@changmen/db";');
  else if(file==='server/db/rds/orderModes/read.js') source=once(source,'import { financialOrdersRelation } from "../orders_execution_compat.js";\n');
  else if(file==='server/db/rds/orderModes/gtc/pm_gtc_settlement.js') source=once(source,'import { financialOrdersRelation } from "../../orders_execution_compat.js";\n');
  else {
    assert(file.startsWith('server/backend/scripts/ops/'),'unregistered compatibility module');
    const tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
    const financial=tree.statements.filter(node=>ts.isImportDeclaration(node)&&node.moduleSpecifier.text==='@changmen/db'&&node.getText(tree).includes('financialOrdersRelation'));
    assert.equal(financial.length,1,'one compatibility import');
    const imp=financial[0];
    const names=imp.importClause.namedBindings.elements.map(n=>n.getText(tree));
    assert(names.includes('financialOrdersRelation'));
    const remaining=names.filter(n=>!['financialOrdersRelation','prepareOrdersExecutionCompatibility'].includes(n));
    const replacement=remaining.length?`import { ${remaining.join(', ')} } from "@changmen/db";`:'';
    source=source.slice(0,imp.getStart(tree))+replacement+source.slice(imp.getEnd());
    // Only the exact pre-query validation installed for standalone pg clients is removed.
    if(names.includes('prepareOrdersExecutionCompatibility')) {
      const validation=/if \(process\.env\.ORDERS_EXECUTION_COMPAT === "1"\) await prepareOrdersExecutionCompatibility\((pool|c)\);/g;
      const calls=[...source.matchAll(validation)];
      assert.equal(calls.length,1,'one exact standalone schema validation');
      const guard=calls[0][0];
      const anchor=calls[0][1]==='pool'?'const pool = getPgPool();':'await c.connect();';
      assert(source.includes(`${anchor}\n${guard}`),'standalone validation must immediately follow connection acquisition before queries');
      source=source.replace(validation,'');
    }
  }
  const relation=/\$\{financialOrdersRelation\((?:"([a-z_]+)")?\)\}/g;
  assert(relation.test(source),'financial relation wiring required');
  return source.replace(relation,(_,alias)=>`orders${alias?` ${alias}`:''}`);
}
export function verifyPhase2Module(file,source=read(file),readSource=read) {
  const restored=restorePhase2Module(file,source,readSource);
  assert.deepEqual(moduleTokens(restored),moduleTokens(gitSource(deployedSource,file)),`${file}: complete deployed module after exact compatibility wiring`);
  return {file,passed:true};
}
