// [changmen 扩展] Exact extraction proof; historical views never affect runtime loading.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
const root=fileURLToPath(new URL('../../',import.meta.url));
export const profileRepairSha=source=>createHash('sha256').update(source.replaceAll('\r\n','\n')).digest('hex');
const text=fs.readFileSync(new URL('./profile-repair-isolation.json',import.meta.url),'utf8');
assert.equal(profileRepairSha(text),'ed037f9108807284cfc378a0b9debe20a9196e4cdaacef293799e156b32d32ea');
export const PROFILE_REPAIR_ISOLATION=JSON.parse(text);
const record=PROFILE_REPAIR_ISOLATION;
assert.equal(record.purpose,'extract-profile-repair-persistence-only');assert.equal(record.entries.length,3);assert.equal(record.operations.length,10);
export const profileRepairHistoryFiles=[...record.entries.map(row=>row.file),...record.metadata.map(row=>row.file),record.dataFile];
const known=new Set(profileRepairHistoryFiles);
const relative=file=>typeof file==='string'&&known.has(file)?file:path.relative(root,file instanceof URL?fileURLToPath(file):path.resolve(file)).replaceAll('\\','/');
export function restoreProfileRepairSource(file,source,read=target=>fs.readFileSync(path.join(root,target),'utf8')){
 const row=[...record.entries,...record.metadata].find(row=>row.file===relative(file));
 if(!row||profileRepairSha(source)!==row.afterSha)return source;
 assert.equal(profileRepairSha(read(record.dataFile)),record.dataSha,'Complete real profile repair persistence is required');
 assert.equal(profileRepairSha(row.before),row.beforeSha);return row.before;
}
export function inspectProfileRepairIsolation(base){
 base=fs.realpathSync(base);
 const read=file=>{const real=fs.realpathSync(path.join(base,file)),rel=path.relative(base,real);assert(rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel));return fs.readFileSync(real,'utf8');};
 const data=read(record.dataFile);assert.equal(profileRepairSha(data),record.dataSha,'Reviewed profile repair data implementation changed');
 const dataTree=ts.createSourceFile(record.dataFile,data,ts.ScriptTarget.Latest,true);assert.equal(dataTree.parseDiagnostics.length,0);
 const imports=dataTree.statements.filter(ts.isImportDeclaration).map(n=>n.moduleSpecifier.text);
 assert.deepEqual(imports,['../pg_pool.js'],'Data persistence cannot import backend/cache/platform implementations');
 const methods=new Map();function dataVisit(node){if(ts.isMethodDeclaration(node))methods.set(node.name.getText(dataTree),node);ts.forEachChild(node,dataVisit);}dataVisit(dataTree);
 assert.equal(methods.size,10); // nine bounded data operations plus close
 for(const op of record.operations){
  const method=methods.get(op.method);assert(method);
  assert.deepEqual(method.parameters.map(n=>n.name.getText(dataTree)),op.parameters);
  const result=method.body.statements[0];assert(ts.isReturnStatement(result));assert(ts.isCallExpression(result.expression));
  const call=result.expression;assert.equal(call.expression.getText(dataTree),'pool.query');assert.equal(call.arguments[0].getText(dataTree),op.sql,'Complete original SQL literal required');
  if(op.parameters.length)assert.deepEqual(call.arguments[1].elements.map(n=>n.getText(dataTree)),op.parameters);else assert.equal(call.arguments.length,1);
 }
 for(const row of record.entries){
  assert.equal(profileRepairSha(row.before),row.beforeSha);let expected=row.before;
  for(const [before,after]of row.replacements){assert(expected.includes(before));expected=expected.replace(before,after);}
  const current=read(row.file);assert.equal(profileRepairSha(current),row.afterSha,row.file+': CLI orchestration changed');
  assert.equal(current.replaceAll('\r\n','\n'),expected);
  const tree=ts.createSourceFile(row.file,current,ts.ScriptTarget.Latest,true);assert.equal(tree.parseDiagnostics.length,0);
  function visit(node){
   if(ts.isImportDeclaration(node))assert(!['@changmen/db','@changmen/db/pg.js','pg'].includes(node.moduleSpecifier.text),'CLI cannot hold a raw database handle');
   if(ts.isCallExpression(node))assert(!['pool.query','pool.connect','pool.end','getPgPool','ensurePgPoolReady'].includes(node.expression.getText(tree)),'CLI data access must use bounded operations');
   ts.forEachChild(node,visit);
  }visit(tree);
  assert.equal(restoreProfileRepairSource(row.file,current,read),row.before);
 }
 for(const row of record.metadata)assert.equal(profileRepairSha(read(row.file)),row.afterSha,'Profile repair public export changed');
 const pkg=JSON.parse(read('server/db/package.json'));assert.equal(pkg.exports['./maintenance/profile_repairs.js'],'./maintenance/profile_repairs.js');
 return {scripts:3,querySites:10,operations:9,backendRawPoolHandles:0,reverseApplicationDependencies:0};
}
