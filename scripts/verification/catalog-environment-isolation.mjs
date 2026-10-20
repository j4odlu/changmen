// [changmen 扩展] Exact configuration extraction; historical reads are verification-only.
import assert from 'node:assert/strict';
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {restoreRdsRetirementMetadata} from './rds-entry-retirement.mjs';
import {restoreRetirementComponentMetadata} from './publish-retirement-metadata.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
export const catalogEnvironmentSha=s=>createHash('sha256').update(s.replaceAll('\r\n','\n')).digest('hex');
const text=fs.readFileSync(new URL('./catalog-environment-isolation.json',import.meta.url),'utf8');
assert.equal(catalogEnvironmentSha(text),'0476a7b2edfe0cf9f8a77ee1bd444554068cac3d5370edf9d8affb6c890ee713','Catalog environment extraction must stay reviewed');
export const CATALOG_ENVIRONMENT_ISOLATION=JSON.parse(text);
const record=CATALOG_ENVIRONMENT_ISOLATION;
assert.equal(record.purpose,'catalog-environment-extraction-only');
export const catalogEnvironmentHistoryFiles=record.changes.map(row=>row.file);
const known=new Set(catalogEnvironmentHistoryFiles);
const relative=file=>typeof file==='string'&&known.has(file)?file:path.relative(root,file instanceof URL?fileURLToPath(file):path.resolve(file)).replaceAll('\\','/');
export function restoreCatalogEnvironmentMetadata(file,source){
 source=restoreRetirementComponentMetadata(file,source);
 source=restoreRdsRetirementMetadata(file,source);
 const key=relative(file),row=record.changes.find(row=>row.file===key);
 if(!row||catalogEnvironmentSha(source)!==row.afterSha)return source;
 assert.equal(catalogEnvironmentSha(row.before),row.beforeSha);return row.before;
}
export function verifyCatalogEnvironmentIsolation(read){
 const certified=new Set();
 for(const row of record.changes){
  assert.equal(catalogEnvironmentSha(read(row.file)),row.afterSha,row.file+': reviewed catalog environment extraction');
  assert.equal(catalogEnvironmentSha(row.before),row.beforeSha);certified.add(row.file);
 }
 for(const row of record.assets){assert.equal(catalogEnvironmentSha(read(row.file)),row.sha256,row.file+': reviewed server catalog adapter');certified.add(row.file);}
 const shared=read('packages/shared/catalog/game_catalog.ts');
 assert(!/\bprocess\b|\bimport\.meta\b|\b(?:require|eval)\s*\(/.test(shared),'Shared game catalog cannot read host environment or load host code');
 return certified;
}
/** Exact runtime files only; a historical reader may already have reversed this extraction. */
export function certifiedCatalogRuntimeChanges(read){
 const certified=new Set();
 for(const row of record.changes.filter(row=>!row.file.startsWith('scripts/')&&/\.[jt]s$/.test(row.file))){
  let source=read(row.file);
  if(catalogEnvironmentSha(source)===row.beforeSha)source=fs.readFileSync(path.join(root,row.file),'utf8');
  assert.equal(catalogEnvironmentSha(source),row.afterSha,row.file+': exact catalog runtime change');certified.add(row.file);
 }
 for(const row of record.assets){assert.equal(catalogEnvironmentSha(read(row.file)),row.sha256);certified.add(row.file);}
 return certified;
}
/** Detect accidental environment-dependent imports in shared catalog and wrong consumer ownership. */
export function inspectCatalogEnvironmentIsolation(base){
 base=fs.realpathSync(base);
 const read=file=>{const real=fs.realpathSync(path.join(base,file)),rel=path.relative(base,real);
  assert(rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel));return fs.readFileSync(real,'utf8');};
 verifyCatalogEnvironmentIsolation(read);
 const active=new Set(['parseActiveGameCodes','getActiveGames','getActivePlatformGameIds','getCatalogSummary','isAllowedPlatformGameId']);
 let callers=0;
 function inspect(file){
  const source=read(file);if(!source.includes('catalog/game_catalog')&&!source.includes('storage/game_catalog'))return;
  const tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
  if(record.esm.includes(file)||record.cjs.includes(file))assert.equal(tree.parseDiagnostics.length,0,file+': invalid source');
  function visit(node){
   if(ts.isImportDeclaration(node)&&ts.isStringLiteralLike(node.moduleSpecifier)){
    const spec=node.moduleSpecifier.text;
    if(spec==='@changmen/shared/catalog/game_catalog')for(const binding of node.importClause?.namedBindings?.elements||[])
     assert(!active.has((binding.propertyName||binding.name).text),file+': server configuration consumer must import @changmen/storage/game_catalog.js');
    if(spec==='@changmen/storage/game_catalog.js')callers++;
   }
   if(ts.isCallExpression(node)&&node.expression.getText(tree).endsWith('.reqS')&&node.arguments[0]&&ts.isStringLiteralLike(node.arguments[0]))
    assert.notEqual(node.arguments[0].text,'catalog/game_catalog',file+': CJS configuration consumer must use server catalog');
   ts.forEachChild(node,visit);
  }
  visit(tree);
 }
 // Runtime sources only. The server adapter itself intentionally imports the pure selectors.
 function walk(dir){for(const item of fs.readdirSync(path.join(base,dir),{withFileTypes:true})){
  if(item.name.startsWith('.')||item.isSymbolicLink()||['node_modules','dist','coverage','storage','platform_adapter','platform_node'].includes(item.name))continue;
  const file=dir+'/'+item.name;
  if(item.isDirectory())walk(file);else if(/\.[cm]?[jt]s$/.test(file)&&!/(?:test|spec)\.[^.]+$/.test(file))inspect(file);
 }}
 for(const dir of ['server/backend','server/platform-probes','server/match','server/collectors','server/ws_forward','server/realtime-hub','server/value-bet'])walk(dir);
 return {sharedEnvironmentReads:0,esmConsumers:callers,cjsConsumers:record.cjs.length,serverAdapter:'server/storage/game_catalog.js'};
}
