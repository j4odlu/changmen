import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import {expect,it} from 'vitest';
import {BROWSER_ENTRY_RETIREMENT,readAdapterHistory,withAdapterHistoryReader} from './browser-entry-history.mjs';
import {inspectBrowserEntryRetirement,verifyBrowserEntryRetirement} from './browser-entry-retirement.mjs';
const read=file=>fs.readFileSync(file,'utf8'),exists=file=>fs.existsSync(file);
it('retires every browser entry on disk while complete original sources remain verifiable',()=>{
 expect(inspectBrowserEntryRetirement(process.cwd()).retired).toBe(595);
 for(const file of BROWSER_ENTRY_RETIREMENT.retired){expect(exists(file)).toBe(false);expect(readAdapterHistory(file,'utf8').length).toBeGreaterThan(0);}
},30000);
it('rejects a retired entry returning even as a thin export',()=>{
 const file=BROWSER_ENTRY_RETIREMENT.retired[0];
 expect(()=>verifyBrowserEntryRetirement(read,f=>f===file||exists(f))).toThrow('retired browser entry must not return');
});
it('rejects unreviewed consumer code',()=>{
 const file='client/web/package.json';
 expect(()=>verifyBrowserEntryRetirement(f=>read(f)+(f===file?'\nchanged':''),exists)).toThrow('complete reviewed consumer change');
 expect(()=>readAdapterHistory('packages/venue-adapter/ob/collect.ts','utf8')).not.toThrow();
});
it('rejects changed and missing real implementations when reconstructing a retired entry',()=>{
 const old='packages/venue-adapter/ob/collect.ts',canonical='client/packages/venue-browser/adapter/ob/collect.ts';
 const changed=withAdapterHistoryReader(file=>file===canonical?read(file)+'\nvoid unexpectedTrade();':read(file));
 expect(()=>changed(old)).toThrow('retired entry still requires the complete real implementation');
 const missing=withAdapterHistoryReader(file=>{if(file===canonical){const error=new Error('missing canonical implementation');error.code='ENOENT';throw error;}return read(file);});
 expect(()=>missing(old)).toThrow('missing canonical implementation');
});
