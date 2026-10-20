// [changmen 扩展] Physical retirement checks; historical metadata is never a runtime resolver.
import assert from 'node:assert/strict';
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {restoreAdminMaintenanceMetadata} from './admin-maintenance-isolation.mjs';
import {restoreRdsLegacyMetadata} from './rds-legacy-relocation.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
export const rdsRetirementSha=s=>createHash('sha256').update(s.replaceAll('\r\n','\n')).digest('hex');
const text=fs.readFileSync(new URL('./rds-entry-retirement.json',import.meta.url),'utf8');
assert.equal(rdsRetirementSha(text),'1e81f774f1d5168f823c13450f4e5bdb3e218af47af9d414dc515f5f8fd0b86b','RDS retirement inventory changed');
export const RDS_ENTRY_RETIREMENT=JSON.parse(text);
const record=RDS_ENTRY_RETIREMENT;
assert.equal(record.purpose,'retire-backend-rds-compatibility-only');
assert.equal(record.publishScopeOptimizationEnabled,false);
assert.equal(record.entries.length,7);assert.equal(record.assets.length,44);assert.equal(record.moves.length,5);
export const rdsRetirementHistoryFiles=record.changes.map(r=>r.file);
export function restoreRdsRetirementMetadata(file,source){
 source=restoreAdminMaintenanceMetadata(file,source);
 const key=typeof file==='string'&&rdsRetirementHistoryFiles.includes(file)?file:path.relative(root,file instanceof URL?fileURLToPath(file):path.resolve(file)).replaceAll('\\','/');
 const row=record.changes.find(r=>r.file===key);
 if(!row||rdsRetirementSha(source)!==row.afterSha)return source;
 assert.equal(rdsRetirementSha(row.before),row.beforeSha);return row.before;
}
export function inspectRdsEntryRetirement(base){
 base=fs.realpathSync(base);
 const read=file=>{const real=fs.realpathSync(path.join(base,file)),rel=path.relative(base,real);
  assert(rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel),'RDS path escapes workspace');return fs.readFileSync(real,'utf8');};
 const absent=file=>assert(!fs.lstatSync(path.join(base,file),{throwIfNoEntry:false}),file+': retired RDS entry or copy returned');
 absent('server/backend/db');
 for(const row of record.entries){absent(row.file);assert.equal(rdsRetirementSha(read(row.canonical)),row.canonicalSha,row.canonical+': RDS implementation changed');}
 for(const row of record.assets){absent(row.file);assert.equal(rdsRetirementSha(read(row.canonical)),row.sha256,row.canonical+': historical asset changed');}
 for(const row of record.moves){absent(row.file);assert.equal(rdsRetirementSha(read(row.canonical)),row.afterSha,row.canonical+': reviewed move changed');}
 for(const row of record.changes)assert.equal(rdsRetirementSha(restoreRdsLegacyMetadata(row.file,read(row.file))),row.afterSha,row.file+': retirement metadata changed');
 // Check literal imports and resource paths against the real tree, including tests.
 const retired=new Set([...record.entries,...record.assets,...record.moves].map(row=>row.file));
 function walk(directory){for(const item of fs.readdirSync(path.join(base,directory),{withFileTypes:true})){
  if(item.name.startsWith('.')||item.isSymbolicLink()||['node_modules','dist','coverage','platform_adapter','platform_node'].includes(item.name)||directory==='server/backend'&&item.name==='storage')continue;
  const file=directory+'/'+item.name;
  if(item.isDirectory()){walk(file);continue;}if(!/\.[cm]?[jt]sx?$/.test(file))continue;
  const source=read(file);if(!/(?:migrations|rds-|observation-schema)/.test(source))continue;
  const tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
  function visit(node){
   if(ts.isStringLiteralLike(node)||ts.isTemplateHead(node)){
    const spec=node.text,target=spec.startsWith('.')?path.posix.normalize(path.posix.join(path.posix.dirname(file),spec)):spec;
    assert(!retired.has(target)&&!target.startsWith('server/backend/db/'),file+': references retired RDS path '+spec);
   }
   ts.forEachChild(node,visit);
  }
  visit(tree);
 }}
 walk('server');
 return {retiredEntries:record.entries.length,removedCopies:record.assets.length,movedTests:4,archivedSql:1,violations:[]};
}
