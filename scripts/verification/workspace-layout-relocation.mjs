import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {WORKSPACE_LAYOUT_RELOCATION as record} from './workspace-layout-history.mjs';
import {readInstallWorkspaces,declaredInstallClosure,frontendInstallBoundary} from './component-install-inputs.mjs';
const sha=s=>createHash('sha256').update(s.replaceAll('\r\n','\n')).digest('hex');
const prefixes=[['server/db','rds'],['server/packages/venue-node-loader','server/venues/loader'],['server/packages/venue-node-registry','server/venues/registry'],['server/packages/venue-adapter-tools','server/venues'],['server/match/identity','packages/shared/match-identity']];
const moved=f=>prefixes.reduce((s,[a,b])=>s===a||s.startsWith(a+'/')?b+s.slice(a.length):s,f);
const names=s=>s.replaceAll('@changmen/venue-node-registry/','@changmen/venue-node/registry/').replaceAll('@changmen/venue-node-loader','@changmen/venue-node').replaceAll('@changmen/venue-adapter-tools','@changmen/venue-node').replaceAll('@changmen/match-identity','@changmen/shared/match-identity');
function tokens(file,source){
 // Constant __dirname resources may need a different number of ".." segments.
 // Compare their resolved repository targets, rather than their segment count.
 const resources=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true),edits=[];
 function resource(node){
  if(ts.isCallExpression(node)&&['path.join','path.resolve','join','resolve'].includes(node.expression.getText(resources))
   &&node.arguments[0]?.getText(resources)==='__dirname'&&node.arguments.slice(1).every(ts.isStringLiteralLike)){
   if(file.endsWith('sync-backend-bundle.mjs')&&['path.join(__dirname, "../registry/paths.js")','path.resolve(__dirname, "..")'].includes(node.getText(resources))){
    edits.push({start:node.getStart(resources),end:node.end,text:`__artifactResource__(${JSON.stringify(node.getText(resources))})`});return;
   }
   const target=path.posix.resolve('/repository',path.posix.dirname(file),...node.arguments.slice(1).map(a=>a.text));
   edits.push({start:node.getStart(resources),end:node.end,text:`__reviewedResource__(${JSON.stringify(moved(path.posix.relative('/repository',target)))})`});return;
  }ts.forEachChild(node,resource);
 }resource(resources);for(const edit of edits.sort((a,b)=>b.start-a.start))source=source.slice(0,edit.start)+edit.text+source.slice(edit.end);
 const tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true),out=[];
 assert.equal(tree.parseDiagnostics.length,0,file+': syntax errors');
 function visit(node){if(node.kind>=ts.SyntaxKind.FirstJSDocNode&&node.kind<=ts.SyntaxKind.LastJSDocNode)return;
  if(ts.isToken(node)&&node.kind!==ts.SyntaxKind.EndOfFileToken)out.push({kind:node.kind,text:node.getText(tree),value:ts.isStringLiteralLike(node)?node.text:null});
  else for(const child of node.getChildren(tree))visit(child);
 }visit(tree);return out;
}
export function assertWorkspaceMoveSemantics(row,source){
 if(!row.file.startsWith('server/db/')&&!/^server\/packages\/venue-(?:node-loader|node-registry|adapter-tools)\//.test(row.file))return;
 if(!/\.[cm]?[jt]s$/.test(row.file)||row.file.includes('.test.'))return;
 const before=tokens(row.file,row.before),after=tokens(row.canonical,source);assert.equal(after.length,before.length,row.file+': token count changed');
 for(let i=0;i<before.length;i++){
  const a=before[i],b=after[i];assert.equal(a.kind,b.kind,row.file+': syntax structure changed');if(a.text===b.text)continue;
  assert(a.value!==null&&b.value!==null,row.file+': executable statement changed');
  let expected=names(a.value);for(const[p,q]of prefixes)expected=expected.replaceAll(p+'/',q+'/');
  if(a.value.startsWith('.')){
   const target=moved(path.posix.normalize(path.posix.join(path.posix.dirname(row.file),a.value)));
   let rel=path.posix.relative(path.posix.dirname(row.canonical),target);if(!rel.startsWith('.'))rel='./'+rel;if(a.value.endsWith('/')&&!rel.endsWith('/'))rel+='/';expected=rel;
  }
  assert.equal(b.value,expected,row.file+': change exceeds import/resource relocation');
 }
}
export function inspectWorkspaceLayout(root,{read=f=>fs.readFileSync(path.join(root,f),'utf8'),exists=f=>fs.existsSync(path.join(root,f))}={}){
 let sql=0,moves=0;
 for(const row of record.files){
  assert.equal(sha(row.before),row.beforeSha,'Original source proof changed');
  if(!row.canonical){assert(!exists(row.file),row.file+': retired entry returned');continue;}
  const source=read(row.canonical);assert.equal(sha(source),row.afterSha,row.canonical+': unreviewed relocation');
  if(row.file!==row.canonical){assert(!exists(row.file),row.file+': old implementation returned');moves++;}
  if(row.file.endsWith('.sql')){assert.equal(source.replaceAll('\r\n','\n'),row.before,'SQL content changed during layout migration');sql++;}
  assertWorkspaceMoveSemantics(row,source);
 }
 const packages=readInstallWorkspaces(root);assert.equal(packages.size,24,'Unexpected workspace count');
 assert.equal(packages.get('@changmen/db')?.dir,'rds');assert.equal(packages.get('@changmen/venue-node')?.dir,'server/venues');
 for(const name of ['venue-adapter','runtime-tooling-compat','match-identity','venue-node-loader','venue-node-registry','venue-adapter-tools'])assert(!packages.has('@changmen/'+name),'Retired workspace returned: '+name);
 for(const name of ['@changmen/web','@changmen/backend','@changmen/db'])assert.deepEqual(declaredInstallClosure(root,packages,name,{build:true}).violations,[]);
 assert.deepEqual(frontendInstallBoundary(declaredInstallClosure(root,packages,'@changmen/web',{build:true})),[]);
 return{workspaces:packages.size,movedFiles:moves,unchangedSqlAssets:sql,rdsRoot:'rds',platformRoot:'server/venues'};
}
