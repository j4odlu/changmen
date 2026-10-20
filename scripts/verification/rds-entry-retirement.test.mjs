import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {expect,it,vi} from 'vitest';
import {inspectRdsEntryRetirement,RDS_ENTRY_RETIREMENT} from './rds-entry-retirement.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
it('removes 44 copies and seven entries, moving four tests and one retired SQL into RDS',()=>{
 expect(inspectRdsEntryRetirement(root)).toEqual({retiredEntries:7,removedCopies:44,movedTests:4,archivedSql:1,violations:[]});
});
for(const row of RDS_ENTRY_RETIREMENT.entries)it('rejects return of '+row.file,()=>{
 const original=fs.lstatSync,spy=vi.spyOn(fs,'lstatSync').mockImplementation((file,...args)=>path.resolve(file)===path.resolve(root,row.file)?{}:original.call(fs,file,...args));
 try{expect(()=>inspectRdsEntryRetirement(root)).toThrow('retired RDS entry or copy returned');}finally{spy.mockRestore();}
});
for(const row of [RDS_ENTRY_RETIREMENT.entries[0],RDS_ENTRY_RETIREMENT.assets[0],RDS_ENTRY_RETIREMENT.moves[0]])it('rejects drift of '+row.canonical,()=>{
 const original=fs.readFileSync,spy=vi.spyOn(fs,'readFileSync').mockImplementation((file,...args)=>{const source=original.call(fs,file,...args);return path.resolve(file)===path.resolve(root,row.canonical)?source+'\nchanged':source;});
 try{expect(()=>inspectRdsEntryRetirement(root)).toThrow();}finally{spy.mockRestore();}
});
it('rejects a new resource reference into the removed backend SQL directory',()=>{
 const target=path.resolve(root,'server/backend/server.js'),original=fs.readFileSync;
 const spy=vi.spyOn(fs,'readFileSync').mockImplementation((file,...args)=>{
  const source=original.call(fs,file,...args);
  return path.resolve(file)===target?source+'\nnew URL("./db/migrations/001_baseline.sql", import.meta.url);':source;
 });
 try{expect(()=>inspectRdsEntryRetirement(root)).toThrow('references retired RDS path');}finally{spy.mockRestore();}
});
