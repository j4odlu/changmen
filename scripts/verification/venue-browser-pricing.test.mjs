import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
import { restoreVenueBrowserExecution } from "./venue-browser-execution.mjs";
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
import {expect,it} from 'vitest';
import {VENUE_BROWSER_PRICING as record,restoreVenueBrowserPricing,verifyVenueBrowserPricing} from './venue-browser-pricing.mjs';
import {verifyVenueBrowserRelocation} from './venue-browser-relocation.mjs';
const read=withAdapterHistoryReader(f=>readAdapterHistory(f,'utf8').replaceAll('\r\n','\n'));
const after=f=>restoreVenueBrowserExecution(f,read(f));
it('moves the complete pricing implementation with only its local tick import changed',()=>{
 expect(verifyVenueBrowserPricing(read)).toEqual({changedFiles:11,modules:1});
 const original=execFileSync('git',['show',record.baseline+':packages/venue-adapter/polymarket/quotes/priceQuote.ts'],{encoding:'utf8',windowsHide:true}).replaceAll('\r\n','\n');
 expect(read('client/packages/venue-browser/polymarket/priceQuote.ts').replace('"./pmTickPrice"','"../pmTickPrice"')).toBe(original);
});
it('preserves every runtime consumer statement except the import or re-export specifier',()=>{
 const body=text=>{const sf=ts.createSourceFile('consumer.ts',text,ts.ScriptTarget.Latest,true);return sf.statements.filter(s=>!ts.isImportDeclaration(s)&&!ts.isExportDeclaration(s)).map(s=>s.getFullText(sf)).join('');};
 for(const row of record.changes.filter(row=>row.file.endsWith('.ts')&&!row.file.endsWith('/quotes/priceQuote.ts')))
  expect(body(after(row.file)),row.file).toBe(body(restoreVenueBrowserPricing(row.file,read(row.file))));
});
it('rejects missing or modified pricing source, consumer imports, facade and ownership through the existing gate',()=>{
 for(const row of [...record.changes,...record.added]){
  expect(()=>verifyVenueBrowserRelocation(f=>read(f)+(f===row.file?'\nvoid changed();\n':''))).toThrow();
  expect(()=>verifyVenueBrowserRelocation(f=>{if(f===row.file)throw Error('missing');return read(f);})).toThrow();
 }
});
