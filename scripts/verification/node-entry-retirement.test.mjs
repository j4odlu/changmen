import fs from 'node:fs';
import path from 'node:path';
import {expect,it,vi} from 'vitest';
import {NODE_ENTRY_RETIREMENT as record,inspectNodeEntryRetirement,previousRetiredNodeEntry,withRetiredNodeEntries} from './node-entry-retirement.mjs';
// This scans every runtime source in the repository, rather than one unit of code.
it('removes every legacy Node entry and leaves no backend source outside server',()=>{
 expect(inspectNodeEntryRetirement(process.cwd())).toMatchObject({retired:4,backendEntriesOutsideServer:0});
 for(const row of record.removed)expect(fs.existsSync(row.file)).toBe(false);
 expect(JSON.parse(fs.readFileSync('packages/venue-adapter/package.json')).exports).toEqual({});
},30000);
it.each(record.removed)('rejects a retired file returning: $file',row=>{
 const stat=fs.lstatSync,spy=vi.spyOn(fs,'lstatSync').mockImplementation((file,...args)=>path.resolve(String(file))===path.resolve(row.file)?{}:stat.call(fs,file,...args));
 try{expect(()=>inspectNodeEntryRetirement(process.cwd())).toThrow('retired Node entry returned');}finally{spy.mockRestore();}
});
it.each(record.removed)('historical views still require the unchanged real implementation: $canonical',row=>{
 expect(previousRetiredNodeEntry(row.file,file=>fs.readFileSync(file,'utf8'))).toBe(row.before);
 expect(()=>previousRetiredNodeEntry(row.file,()=> 'export const replaced = true;')).toThrow('exact retained implementation');
 expect(()=>previousRetiredNodeEntry(row.file,()=>{throw Error('missing canonical');})).toThrow('missing canonical');
});
it('does not mask changed real files, missing unrelated files or resolver failures',()=>{
 expect(withRetiredNodeEntries(()=> 'unexpected')(record.removed[0].file)).toBe('unexpected');
 expect(()=>withRetiredNodeEntries(()=>{throw Object.assign(Error('missing'),{code:'ENOENT'});})('server/unrelated.js')).toThrow('missing');
 expect(()=>withRetiredNodeEntries(()=>{throw Object.assign(Error('denied'),{code:'EACCES'});})(record.removed[0].file)).toThrow('denied');
});
it.each(record.removed)('Node cannot import the deleted entry: $file',async row=>{
 await expect(import(new URL('../../'+row.file,import.meta.url).href)).rejects.toThrow();
});
