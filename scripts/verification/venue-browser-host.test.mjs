import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
import {restoreVenueBrowserMarketHosts} from './venue-browser-market-hosts.mjs';
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {expect,it} from 'vitest';
import {VENUE_BROWSER_HOST as record,restoreVenueBrowserHost,verifyVenueBrowserHost} from './venue-browser-host.mjs';
import {verifyVenueBrowserRelocation} from './venue-browser-relocation.mjs';
const read=withAdapterHistoryReader(file=>readAdapterHistory(file,'utf8').replaceAll('\r\n','\n'));
const sha=s=>createHash('sha256').update(s).digest('hex');
it('restores the exact previous factory location, forwarding entry and inventory',()=>{
 expect(verifyVenueBrowserHost(read)).toEqual({hostEntries:1,restoredFiles:3});
 for(const row of record.changes){
  const restored=restoreVenueBrowserHost(row.file,read(row.file),read);
  expect(sha(restored)).toBe(row.beforeSha);
  if(!row.file.endsWith('.json'))expect(restored).toBe(execFileSync('git',['show',record.baseline+':'+row.file],{encoding:'utf8',windowsHide:true}).replaceAll('\r\n','\n'));
  expect(sha(restoreVenueBrowserHost(row.file,read(row.file)+'\n',read))).not.toBe(row.beforeSha);
 }
});
it('rejects missing or changed host, callbacks, facade and inventory through the historical verifier',()=>{
 for(const row of [...record.changes,...record.added]){
  expect(()=>verifyVenueBrowserRelocation(file=>read(file)+(file===row.file?'\nvoid changed();\n':''))).toThrow();
  expect(()=>verifyVenueBrowserRelocation(file=>{if(file===row.file)throw Error('missing');return read(file);})).toThrow();
 }
 const host=record.added[0].file;
 expect(()=>verifyVenueBrowserHost(file=>file===host?restoreVenueBrowserMarketHosts(file,read(file)).replace('"esport"','"sports"'):read(file))).toThrow();
});
it('browser sources use only declared client dependencies, with no adapter back edge',()=>{
 const root='client/packages/venue-browser';
 const files=fs.readdirSync(root,{recursive:true}).filter(file=>file.endsWith('.ts')&&!file.split(/[\\/]/).includes('node_modules')
  && !/(?:^|[\\/])(?:tests?|__tests__|scripts)(?:[\\/]|$)|\.(?:test|spec)\./.test(file));
 expect(files.length).toBeGreaterThanOrEqual(18);
 const seen=new Set();
 for(const file of files){
  if(seen.has(file))continue;seen.add(file);
  const importer=root+'/'+file.replaceAll('\\','/');
  for(const {fileName:spec} of ts.preProcessFile(read(importer),true,true).importedFiles){
   if(spec.startsWith('.')){
    const target=path.posix.normalize(path.posix.join(path.posix.dirname(importer),spec));
    expect(target.startsWith(root+'/'),importer+' -> '+spec).toBe(true);
    expect(fs.existsSync(target)||fs.existsSync(target+'.ts'),target).toBe(true);
    const actual=[target,target+'.ts',target+'/index.ts'].find(candidate=>fs.existsSync(candidate)&&fs.statSync(candidate).isFile());
    if(actual?.endsWith('.ts'))files.push(actual.slice(root.length+1));
   }else {
    const pkg=JSON.parse(read(root+'/package.json'));
    const dependencies={...pkg.dependencies,...pkg.peerDependencies};
    const name=spec.startsWith('@')?spec.split('/').slice(0,2).join('/'):spec.split('/')[0];
    expect(name===pkg.name||Object.hasOwn(dependencies,name),importer+' -> '+spec).toBe(true);
    if(name===pkg.name){
     const target=pkg.exports['.'+spec.slice(name.length)];
     expect(typeof target,importer+' -> '+spec).toBe('string');
     files.push(target.slice(2));
    }
    expect(name).not.toBe('@changmen/venue-adapter');
   }
  }
 }
});
