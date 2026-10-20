// [changmen 扩展] Preserve historical environment/output context without running a maintenance script.
import assert from 'node:assert/strict';
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isBuiltin} from 'node:module';
import {historicalCreateRequire as createRequire} from './workspace-layout-history.mjs';
import ts from 'typescript';
import {profileRepairHistoryFiles,restoreProfileRepairSource} from './profile-repair-isolation.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
export const rdsContextSha=source=>createHash('sha256').update(source.replaceAll('\r\n','\n')).digest('hex');
const text=fs.readFileSync(new URL('./rds-context-relocation.json',import.meta.url),'utf8');
assert.equal(rdsContextSha(text),'bbffe544c34faab5bbbaf79a292a8747603f6242bafdcaf14e826b0d81c308f2');
export const RDS_CONTEXT_RELOCATION=JSON.parse(text);
const record=RDS_CONTEXT_RELOCATION;
assert.equal(record.purpose,'relocate-rds-context-sensitive-tools-only');assert.equal(record.moves.length,10);
export const rdsContextHistoryFiles=[...record.moves.flatMap(row=>[row.file,row.canonical]),...record.metadata.map(row=>row.file),record.lock.file,...profileRepairHistoryFiles];
const known=new Set(rdsContextHistoryFiles),moves=new Map(record.moves.map(row=>[row.file,row]));
const relative=file=>typeof file==='string'&&known.has(file)?file:path.relative(root,file instanceof URL?fileURLToPath(file):path.resolve(file)).replaceAll('\\','/');
export function restoreRdsContextMetadata(file,source){
 source=restoreProfileRepairSource(file,source);
 const key=relative(file),row=record.metadata.find(row=>row.file===key);
 if(row&&rdsContextSha(source)===row.afterSha){assert.equal(rdsContextSha(row.before),row.beforeSha);return row.before;}
 if(key!==record.lock.file||rdsContextSha(source)!==record.lock.afterSha)return source;
 const lock=JSON.parse(source);assert.deepEqual(lock.packages['server/db'],record.lock.afterEntry);lock.packages['server/db']=record.lock.beforeEntry;
 const before=JSON.stringify(lock,null,2)+'\n';assert.equal(rdsContextSha(before),record.lock.beforeSha,'Complete prior lock must restore');return before;
}
export function previousRdsContextEntry(file,read){
 const row=moves.get(relative(file));if(!row)return undefined;
 assert.equal(rdsContextSha(read(row.canonical)),row.afterSha,row.canonical+': exact context relocation required');
 assert.equal(rdsContextSha(row.before),row.beforeSha);return row.before;
}
function sourceTree(source){const tree=ts.createSourceFile('maintenance.mjs',source,ts.ScriptTarget.Latest,true);assert.equal(tree.parseDiagnostics.length,0);return tree;}
// Only evaluate the reviewed path expressions, never file reads, environment loading or SQL.
export function contextResourceTargets(row,source,moduleFile,{outArg}={}){
 const tree=sourceTree(source),variables=new Map();
 function visit(node){if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.initializer)variables.set(node.name.text,node.initializer);ts.forEachChild(node,visit);}visit(tree);
 const values={path,dirname:path.dirname,join:path.join,resolve:path.resolve,fileURLToPath,__dirname:path.dirname(moduleFile),__dir:path.dirname(moduleFile),moduleUrl:pathToFileURL(moduleFile).href,outArg,Date:{now:()=>1792440000000}};
 const allowedCalls=new Set(['path.join','path.resolve','path.dirname','dirname','join','resolve','fileURLToPath','Date.now']);
 function evaluate(node){assert(node,'Missing reviewed path initializer');
  function check(n){if(ts.isCallExpression(n))assert(allowedCalls.has(n.expression.getText(tree)),'Unreviewed resource expression');ts.forEachChild(n,check);}check(node);
  const expression=node.getText(tree).replaceAll('import.meta.url','moduleUrl');return Function(...Object.keys(values),`return (${expression});`)(...Object.values(values));
 }
 if(row.context==='backend-env')return {env:evaluate(variables.get('envPath'))};
 if(row.context==='original-ops-env')return {env:evaluate(variables.get('envText').arguments[0])};
 if(row.context==='repository-root'){values.root=evaluate(variables.get('root'));return {env:path.join(values.root,'server/backend/.env')};}
 if(row.context==='backup-root'){values.backendRoot=evaluate(variables.get('backendRoot'));return {out:evaluate(variables.get('outPath'))};}
 if(row.context==='caller-cwd'){assert(source.includes('config({ path: ".env" });'));return {env:'.env',relativeToCaller:true};}
 return {};
}
export function inspectRdsContextRelocation(base){
 base=fs.realpathSync(base);let imports=0,unchanged=0,repairedImports=0;
 const read=file=>{const real=fs.realpathSync(path.join(base,file)),rel=path.relative(base,real);assert(rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel));return fs.readFileSync(real,'utf8');};
 for(const row of record.moves){
  assert(!fs.lstatSync(path.join(base,row.file),{throwIfNoEntry:false}),row.file+': retired context script returned');
  const source=read(row.canonical);assert.equal(rdsContextSha(source),row.afterSha,row.canonical+': reviewed context relocation changed');
  let expected=row.before;assert.equal(rdsContextSha(expected),row.beforeSha);for(const[a,b]of row.replacements){assert.equal(expected.split(a).length,2);expected=expected.replace(a,b);}
  assert.equal(source.replaceAll('\r\n','\n'),expected.replaceAll('\r\n','\n'));if(!row.replacements.length)unchanged++;
  for(const outArg of [undefined,'relative-backup.json',path.join(base,'output','explicit-backup.json')])
   assert.deepEqual(contextResourceTargets(row,source,path.join(base,row.canonical),{outArg}),contextResourceTargets(row,row.before,path.join(base,row.file),{outArg}),'Original environment/output resource changed');
  const specs=text=>{const tree=sourceTree(text),result=[];function visit(node){
   if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier)result.push(node.moduleSpecifier.text);
   if(ts.isCallExpression(node)&&['import','require'].includes(node.expression.getText(tree))){assert(node.arguments[0]&&ts.isStringLiteralLike(node.arguments[0]));result.push(node.arguments[0].text);}
   ts.forEachChild(node,visit);
  }visit(tree);return result;};
  const beforeSpecs=specs(row.before),afterSpecs=specs(source);assert.equal(beforeSpecs.length,afterSpecs.length);
  const oldRequire=createRequire(path.join(base,row.file)),nextRequire=createRequire(path.join(base,row.canonical));
  for(let i=0;i<afterSpecs.length;i++){
   const spec=afterSpecs[i],oldSpec=beforeSpecs[i];if(isBuiltin(spec)){assert.equal(spec,oldSpec);continue;}
   const target=fs.realpathSync(nextRequire.resolve(spec)),rel=path.relative(base,target).replaceAll('\\','/');
   assert(!/^(?:client\/|server\/(?:backend|match|collectors|platform-probes)\/)/.test(rel),'Data script reaches application implementation');
   if(oldSpec==='@changmen/match-identity/teams/team_key.js'){
    assert.equal(spec,'@changmen/shared/match-identity/teams/team_key.js');
    assert.equal(fs.readFileSync(oldRequire.resolve(oldSpec),'utf8').replace(/\/\/[^\n]*/g,'').trim(),`export * from "${spec}";`,'Original identity must be a pure facade');
   }else if(row.context==='repair-broken-relative-import'&&oldSpec==='../../db/player_account_record.js'){
    assert(!fs.existsSync(path.resolve(path.dirname(path.join(base,row.file)),oldSpec)),'Former broken target unexpectedly exists');assert.equal(rel,'server/db/player_account_record.js');repairedImports++;
   }else assert.equal(fs.realpathSync(oldRequire.resolve(oldSpec)),target,'Imported module identity changed');
   imports++;
  }
 }
 for(const row of record.metadata)assert.equal(rdsContextSha(restoreProfileRepairSource(row.file,read(row.file),read)),row.afterSha,row.file+': context ownership metadata changed');
 const lockText=read(record.lock.file);assert.equal(rdsContextSha(lockText),record.lock.afterSha);restoreRdsContextMetadata(record.lock.file,lockText);
 assert.equal(JSON.parse(read('server/db/package.json')).dependencies.dotenv,'^17.4.2');
 return {moved:10,unchanged,imports,repairedImports,resourceTargetsPreserved:true,newLockedPackageVersions:0};
}
