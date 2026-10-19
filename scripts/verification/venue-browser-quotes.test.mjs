import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
import {expect,it} from 'vitest';
import {VENUE_BROWSER_QUOTES as record,restoreVenueBrowserQuotes,verifyVenueBrowserQuotes} from './venue-browser-quotes.mjs';
import {verifyVenueBrowserRelocation} from './venue-browser-relocation.mjs';
import {restoreVenueBrowserLifecycle} from './venue-browser-lifecycle.mjs';
const read=withAdapterHistoryReader(f=>readAdapterHistory(f,'utf8').replaceAll('\r\n','\n'));
const original=f=>execFileSync('git',['show',record.baseline+':'+f],{encoding:'utf8',windowsHide:true}).replaceAll('\r\n','\n');
const declaration=(source,name)=>{const sf=ts.createSourceFile('original.ts',source,ts.ScriptTarget.Latest,true);return sf.statements.find(s=>s.name?.text===name).getText(sf);};
it('moves complete original declarations and the entire parser without changing any rules',()=>{
 expect(verifyVenueBrowserQuotes(read)).toEqual({changedFiles:7,modules:3});
 const api=original('packages/venue-adapter/polymarket/transport/api.ts'),parse=original('packages/venue-adapter/polymarket/markets/parse.ts');
 expect(read('client/packages/venue-browser/polymarket/marketMessage.ts'))
  .toBe(['PolymarketWsPriceChange','PolymarketWsMessage'].map(name=>declaration(api,name)).join('\n\n')+'\n');
 expect(read('client/packages/venue-browser/polymarket/bookQuote.ts'))
  .toBe(['PolymarketBook','PolymarketPriceLevel','bestAskFromBook'].map(name=>declaration(parse,name)).join('\n\n')+'\n');
 expect(read('client/packages/venue-browser/polymarket/wsQuotes.ts').replace('"./marketMessage"','"../api"').replace('"./bookQuote"','"../parse"'))
  .toBe(original('packages/venue-adapter/polymarket/realtime/wsQuotes.ts'));
});
it('preserves API runtime emission and every quote hub statement outside imports',()=>{
 const file='packages/venue-adapter/polymarket/transport/api.ts';
 const emit=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,removeComments:true}}).outputText;
 expect(emit(restoreVenueBrowserLifecycle(file,read(file)))).toBe(emit(restoreVenueBrowserQuotes(file,read(file))));
 const body=text=>{const sf=ts.createSourceFile('hub.ts',text,ts.ScriptTarget.Latest,true);return sf.statements.filter(s=>!ts.isImportDeclaration(s)).map(s=>s.getFullText(sf)).join('');};
 for(const name of ['marketQuoteHub','sportQuoteHub']){
  const hub=`packages/venue-adapter/polymarket/quotes/${name}.ts`;
  expect(body(restoreVenueBrowserLifecycle(hub,read(hub)))).toBe(body(restoreVenueBrowserQuotes(hub,read(hub))));
 }
});
it('rejects missing or modified extracted declarations, facade, imports and metadata through the full existing gate',()=>{
 for(const row of [...record.changes,...record.added]){
  expect(()=>verifyVenueBrowserRelocation(f=>read(f)+(f===row.file?'\nvoid changed();\n':''))).toThrow();
  expect(()=>verifyVenueBrowserRelocation(f=>{if(f===row.file)throw Error('missing');return read(f);})).toThrow();
 }
});
