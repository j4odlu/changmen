import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import path from 'node:path';
import ts from 'typescript';
import {expect,it} from 'vitest';
import {adapterHistoryDependencyFile,adapterHistorySystem,readAdapterHistory} from './browser-entry-history.mjs';

it('reads a resolved historical nested dependency through the same owner as TypeScript probes',()=>{
 const old=path.resolve('packages/venue-adapter/node_modules/@noble/hashes/package.json');
 const current=path.resolve('client/packages/venue-browser/node_modules/@noble/hashes/package.json');
 expect(adapterHistoryDependencyFile(old)).toBe(current);
 expect(adapterHistorySystem(ts.sys).fileExists(old)).toBe(true);
 expect(readAdapterHistory(old,'utf8')).toBe(fs.readFileSync(current,'utf8'));
 expect(adapterHistorySystem(ts.sys).readFile(old)).toBe(readAdapterHistory(old,'utf8'));
 expect(JSON.parse(readAdapterHistory(old,'utf8')).version).toBe('1.3.2');
});

it('keeps root-hoisted dependency reads unchanged and does not invent missing packages',()=>{
 const root=path.resolve('node_modules/typescript/package.json');
 expect(adapterHistoryDependencyFile(root)).toBe(root);
 expect(readAdapterHistory(root,'utf8')).toBe(fs.readFileSync(root,'utf8'));
 const missing=path.resolve('packages/venue-adapter/node_modules/@changmen/missing-history-test/package.json');
 expect(adapterHistorySystem(ts.sys).fileExists(missing)).toBe(false);
 expect(adapterHistorySystem(ts.sys).readFile(missing)).toBeUndefined();
 expect(()=>readAdapterHistory(missing,'utf8')).toThrow(/ENOENT/);
});
