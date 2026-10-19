import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
import {expect,it} from 'vitest';
import {VENUE_BROWSER_LEAVES as record,readVenueBrowserLeafSource,restoreVenueBrowserLeafEdits,verifyVenueBrowserLeaves} from './venue-browser-leaves.mjs';
const read=file=>fs.readFileSync(file,'utf8').replaceAll('\r\n','\n');
const original=file=>execFileSync('git',['show',record.baseline+':'+file],{encoding:'utf8',windowsHide:true}).replaceAll('\r\n','\n');
it('retains all three full original modules with only local import rebasing',()=>{
 expect(verifyVenueBrowserLeaves(read).entries).toBe(3);
 for(const row of record.rows)expect(readVenueBrowserLeafSource(row.file,read(row.file),read)).toBe(original(row.file));
});
it('rejects altered facades, changed implementations and missing implementations',()=>{
 for(const row of record.rows){
  for(const target of [row.file,row.canonical]){
   expect(()=>verifyVenueBrowserLeaves(file=>read(file)+(file===target?'\nthrow Error("extra");\n':''))).toThrow();
   expect(()=>verifyVenueBrowserLeaves(file=>{if(file===target)throw Error('missing');return read(file);})).toThrow();
  }
  expect(()=>readVenueBrowserLeafSource(row.file,row.wrapper.replace('client/','elsewhere/'),read)).toThrow();
 }
});
it('only restores the exact consumer imports and compatibility inventory',()=>{
 for(const row of [...record.changes,...record.metadata]){
  expect(restoreVenueBrowserLeafEdits(row.file,read(row.file))).toBe(original(row.file));
  expect(restoreVenueBrowserLeafEdits(row.file,read(row.file)+'\nvoid changed();')).not.toBe(original(row.file));
 }
 expect(restoreVenueBrowserLeafEdits('unregistered.ts','unknown();')).toBe('unknown();');
});
it('keeps the extracted dependency closure entirely within the three pure modules',()=>{
 const allowed=new Set(record.rows.map(row=>row.canonical));
 for(const row of record.rows){
  const source=ts.createSourceFile(row.canonical,read(row.canonical),ts.ScriptTarget.Latest,true);
  expect(source.parseDiagnostics).toEqual([]);
  const imports=ts.preProcessFile(source.text,true,true);
  for(const dependency of imports.importedFiles){
   expect(dependency.fileName.startsWith('.')).toBe(true);
   expect(allowed.has(path.posix.normalize(path.posix.join(path.posix.dirname(row.canonical),dependency.fileName+'.ts')))).toBe(true);
  }
  expect(imports.referencedFiles).toEqual([]);
 }
});
