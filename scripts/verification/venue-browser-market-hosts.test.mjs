import {withAdapterHistoryReader,readAdapterHistory,adapterHistorySystem} from "./browser-entry-history.mjs";
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {expect,it} from 'vitest';
import {VENUE_BROWSER_MARKET_HOSTS as record,restoreVenueBrowserMarketHosts,verifyVenueBrowserMarketHosts} from './venue-browser-market-hosts.mjs';
import {verifyVenueBrowserRelocation} from './venue-browser-relocation.mjs';
import {readAdapterBrowserSource,restoreAdapterBrowserMetadata} from './adapter-browser-relocation.mjs';
const read=withAdapterHistoryReader(f=>readAdapterBrowserSource(f,readAdapterHistory(f,'utf8')).replaceAll('\r\n','\n'));
const canonical=file=>file==='packages/venue-adapter/browser/pm-book-source-host.ts'?'client/packages/venue-browser/pm-book-source-host.ts':'client/packages/venue-browser/'+file.slice('packages/venue-adapter/'.length);
const moved=record.changes.filter(row=>record.added.some(a=>a.file===canonical(row.file)));
const normalizeTargets=source=>{
 const sf=ts.createSourceFile('source.ts',source,ts.ScriptTarget.Latest,true),edits=new Map();
 function visit(node){
  let lit;
  if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier)lit=node.moduleSpecifier;
  if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword)lit=node.arguments[0];
  if(ts.isNewExpression(node)&&node.expression.getText(sf)==='URL')lit=node.arguments?.[0];
  if(ts.isImportTypeNode(node)&&ts.isLiteralTypeNode(node.argument))lit=node.argument.literal;
  if(lit&&ts.isStringLiteral(lit))edits.set(lit.getStart(sf),lit.end);
  ts.forEachChild(node,visit);
 }
 visit(sf);for(const [start,end] of [...edits].sort((a,b)=>b[0]-a[0]))source=source.slice(0,start)+'"dependency"'+source.slice(end);return source;
};
it('moves 9 complete implementations preserving every non-module-specifier byte including dynamic import timing',()=>{
 expect(verifyVenueBrowserMarketHosts(read)).toEqual({changedFiles:14,modules:9});expect(moved).toHaveLength(9);
 for(const row of moved)expect(normalizeTargets(read(canonical(row.file))),row.file)
  .toBe(normalizeTargets(restoreVenueBrowserMarketHosts(row.file,read(row.file))));
});
it('keeps consumer bodies unchanged and locks the same signing dependency version at its new workspace owner',()=>{
 const body=text=>{const sf=ts.createSourceFile('source.ts',text,ts.ScriptTarget.Latest,true);return sf.statements.filter(s=>!ts.isImportDeclaration(s)&&!ts.isExportDeclaration(s)).map(s=>s.getFullText(sf)).join('');};
 for(const row of record.changes.filter(row=>row.file.endsWith('.ts')&&!moved.includes(row)))
  expect(body(read(row.file)),row.file).toBe(body(restoreVenueBrowserMarketHosts(row.file,read(row.file))));
 const metadata=file=>restoreAdapterBrowserMetadata(file,read(file));
 const lock=JSON.parse(metadata('package-lock.json')),prior=JSON.parse(restoreVenueBrowserMarketHosts('package-lock.json',read('package-lock.json')));
 const pkg=JSON.parse(metadata('client/packages/venue-browser/package.json'));
 expect(lock.packages['client/packages/venue-browser'].dependencies).toEqual(pkg.dependencies);
 expect(pkg.peerDependencies).toEqual({vue:'^3.5.13'});
 expect(pkg.peerDependenciesMeta).toEqual({vue:{optional:true}});
 expect(pkg.dependencies.vue).toBeUndefined();
 expect(lock.packages['client/packages/venue-browser'].peerDependencies).toEqual(pkg.peerDependencies);
 expect(lock.packages['client/packages/venue-browser'].peerDependenciesMeta).toEqual(pkg.peerDependenciesMeta);
 lock.packages['client/packages/venue-browser']=prior.packages['client/packages/venue-browser'];expect(lock).toEqual(prior);
});
it('preserves the actual target of every static, dynamic and type dependency after following old forwarding entries',()=>{
 const imports=(file,source)=>{
  const sf=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true),result=[];
  function visit(node){
   let lit;
   if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier)lit=node.moduleSpecifier;
   if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword)lit=node.arguments[0];
  if(ts.isNewExpression(node)&&node.expression.getText(sf)==='URL')lit=node.arguments?.[0];
   if(ts.isImportTypeNode(node)&&ts.isLiteralTypeNode(node.argument))lit=node.argument.literal;
   if(lit&&ts.isStringLiteral(lit))result.push(lit.text);
   ts.forEachChild(node,visit);
  }
  visit(sf);return result;
 };
 const resolve=(file,spec)=>{
  const resolved=ts.resolveModuleName(spec,path.resolve(file),{moduleResolution:ts.ModuleResolutionKind.Bundler},adapterHistorySystem(ts.sys)).resolvedModule;
  expect(resolved,file+' -> '+spec).toBeDefined();
  let target=path.relative(process.cwd(),resolved.resolvedFileName).replaceAll('\\','/');
  const seen=new Set();
  while(!target.includes('node_modules/')){
   expect(seen.has(target),target).toBe(false);seen.add(target);
   const parsed=ts.createSourceFile(target,read(target),ts.ScriptTarget.Latest,true),stmt=parsed.statements[0];
   if(parsed.statements.length!==1||!((ts.isExportDeclaration(stmt)&&!stmt.exportClause)||(ts.isImportDeclaration(stmt)&&!stmt.importClause))||!stmt.moduleSpecifier||!ts.isStringLiteral(stmt.moduleSpecifier))break;
   const next=ts.resolveModuleName(stmt.moduleSpecifier.text,path.resolve(target),{moduleResolution:ts.ModuleResolutionKind.Bundler},adapterHistorySystem(ts.sys)).resolvedModule;
   expect(next,target).toBeDefined();target=path.relative(process.cwd(),next.resolvedFileName).replaceAll('\\','/');
  }
  if(target.includes('node_modules/')){
   const offset=target.lastIndexOf('node_modules/')+'node_modules/'.length;
   const parts=target.slice(offset).split('/'),count=parts[0].startsWith('@')?2:1;
   const base=target.slice(0,offset)+parts.slice(0,count).join('/');
   const pkg=JSON.parse(read(base+'/package.json'));
   return pkg.name+'@'+pkg.version+'/'+parts.slice(count).join('/');
  }
  return target;
 };
 for(const row of moved){
  const prior=imports(row.file,restoreVenueBrowserMarketHosts(row.file,read(row.file))),current=imports(canonical(row.file),read(canonical(row.file)));
  expect(current).toHaveLength(prior.length);
  for(let i=0;i<prior.length;i++)expect(resolve(canonical(row.file),current[i]),row.file+' -> '+prior[i]).toBe(resolve(row.file,prior[i]));
 }
 const browser=JSON.parse(read('client/packages/venue-browser/package.json')),adapter=JSON.parse(read('packages/venue-adapter/package.json')),web=JSON.parse(read('client/web/package.json'));
 for(const [name,version] of Object.entries(browser.dependencies))if(!name.startsWith('@changmen/'))expect(version,name).toBe(adapter.dependencies[name]??web.dependencies[name]);
});
it('rejects modified or missing original entries, canonical code, consumers and metadata through the existing complete gate',()=>{
 for(const row of [...record.changes,...record.added]){
  expect(()=>verifyVenueBrowserRelocation(f=>read(f)+(f===row.file?'\nvoid changed();\n':''))).toThrow();
  expect(()=>verifyVenueBrowserRelocation(f=>{if(f===row.file)throw Error('missing');return read(f);})).toThrow();
 }
});
it('retains only forwarding modules and the registered adapter composition in the old PM tree',()=>{
 const root='packages/venue-adapter/polymarket';
 for(const relative of fs.readdirSync(root,{recursive:true})){
  const file=root+'/'+relative.replaceAll('\\','/');
  if(!file.endsWith('.ts')||file.includes('/tests/')||file.endsWith('.test.ts')||file===root+'/index.ts')continue;
  const source=ts.createSourceFile(file,read(file),ts.ScriptTarget.Latest,true);
  expect(source.statements.every(node=>ts.isImportDeclaration(node)||ts.isExportDeclaration(node)),file).toBe(true);
 }
});
