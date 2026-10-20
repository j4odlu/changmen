// [changmen 扩展] Exact physical moves of pure legacy data scripts; never executes them.
import assert from 'node:assert/strict';
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {isBuiltin} from 'node:module';
import {historicalCreateRequire as createRequire} from './workspace-layout-history.mjs';
import ts from 'typescript';
import {restoreProfileRepairSource} from './profile-repair-isolation.mjs';
import {rdsContextHistoryFiles,restoreRdsContextMetadata,previousRdsContextEntry} from './rds-context-relocation.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
export const rdsLegacySha=source=>createHash('sha256').update(source.replaceAll('\r\n','\n')).digest('hex');
const text=fs.readFileSync(new URL('./rds-legacy-relocation.json',import.meta.url),'utf8');
assert.equal(rdsLegacySha(text),'fb024940015e64a4553f49cf5e17a01376a1dfdc5d7612d8e083ff2b7e7005bc');
export const RDS_LEGACY_RELOCATION=JSON.parse(text);
const record=RDS_LEGACY_RELOCATION;
assert.equal(record.purpose,'relocate-pure-rds-legacy-scripts-only');assert.equal(record.publishScopeOptimizationEnabled,false);assert.equal(record.moves.length,130);
const moves=new Map(record.moves.map(row=>[row.file,row]));
export const rdsLegacyHistoryFiles=[...moves.keys(),...record.moves.map(row=>row.canonical),...record.metadata.map(row=>row.file),...rdsContextHistoryFiles];
const known=new Set(rdsLegacyHistoryFiles);
const relative=file=>typeof file==='string'&&known.has(file)?file:path.relative(root,file instanceof URL?fileURLToPath(file):path.resolve(file)).replaceAll('\\','/');
export function restoreRdsLegacyMetadata(file,source){
 source=restoreRdsContextMetadata(file,source);
 const row=record.metadata.find(row=>row.file===relative(file));if(!row||rdsLegacySha(source)!==row.afterSha)return source;
 assert.equal(rdsLegacySha(row.before),row.beforeSha);return row.before;
}
export function previousRdsLegacyEntry(file,read){
 const row=moves.get(relative(file));if(!row)return previousRdsContextEntry(file,read);
 assert.equal(rdsLegacySha(read(row.canonical)),row.afterSha,row.canonical+': exact relocated data script required');
 assert.equal(rdsLegacySha(row.before),row.beforeSha);return row.before;
}
export function withRdsLegacyEntries(read){
 return file=>{try{return restoreProfileRepairSource(file,read(file),read);}catch(error){
  if(error.code!=='ENOENT')throw error;
  const previous=previousRdsLegacyEntry(file,read);if(previous===undefined)throw error;return previous;
 }};
}
export function inspectRdsLegacyRelocation(base){
 base=fs.realpathSync(base);let imports=0,unchanged=0;
 const read=file=>{const real=fs.realpathSync(path.join(base,file)),rel=path.relative(base,real);
  assert(rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel),'Legacy data script escapes workspace');return fs.readFileSync(real,'utf8');};
 for(const row of record.moves){
  assert(!fs.lstatSync(path.join(base,row.file),{throwIfNoEntry:false}),row.file+': retired data script returned');
  const source=read(row.canonical);assert.equal(rdsLegacySha(source),row.afterSha,row.canonical+': complete relocated source changed');
  let expected=row.before;assert.equal(rdsLegacySha(expected),row.beforeSha);
  for(const change of row.replacements){assert.equal(expected.slice(change.start,change.end),change.before);expected=expected.slice(0,change.start)+change.after+expected.slice(change.end);}
  assert.equal(source.replaceAll('\r\n','\n'),expected.replaceAll('\r\n','\n'),'Only exact relative import paths may change');if(!row.replacements.length)unchanged++;
  const tree=ts.createSourceFile(row.canonical,source,ts.ScriptTarget.Latest,true);assert.equal(tree.parseDiagnostics.length,0);
  const oldRequire=createRequire(path.join(base,row.file)),nextRequire=createRequire(path.join(base,row.canonical));
  function check(spec){
   assert(spec&&spec!=='<dynamic>','Unreviewed dynamic import in data maintenance');
   if(isBuiltin(spec))return;
   const target=nextRequire.resolve(spec),rel=path.relative(base,fs.realpathSync(target)).replaceAll('\\','/');
   assert(!/^server\/(?:backend|match|collectors|platform-probes)\//.test(rel)&&!/^client\//.test(rel),row.canonical+': data script reaches application implementation');
   let oldSpec=spec;for(const c of row.replacements)if(c.after===spec)oldSpec=c.before;
   assert.equal(fs.realpathSync(oldRequire.resolve(oldSpec)),fs.realpathSync(target),row.canonical+': module resolution changed');imports++;
  }
  function visit(node){
   if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier)check(node.moduleSpecifier.text);
   if(ts.isCallExpression(node)&&['import','require'].includes(node.expression.getText(tree)))check(node.arguments[0]&&ts.isStringLiteralLike(node.arguments[0])?node.arguments[0].text:'<dynamic>');
   ts.forEachChild(node,visit);
  }
  visit(tree);
 }
 for(const row of record.metadata)assert.equal(rdsLegacySha(restoreRdsContextMetadata(row.file,read(row.file))),row.afterSha,row.file+': legacy command wiring changed');
 return {moved:record.moves.length,unchanged,relativeImportUpdates:record.moves.length-unchanged,imports,reverseApplicationDependencies:0};
}
