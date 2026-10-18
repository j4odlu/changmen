// [changmen 扩展] 清单完整性、来源及非 DisplayOnly 模块负向检查，避免只修首个失败后漏查。
import fs from 'node:fs';
import { execFileSync,spawnSync } from 'node:child_process';
import { describe,it,expect } from 'vitest';
import { fixedManifestSources,verifyManifestSources } from './vps-source-manifest-boundary.mjs';
const manifest=JSON.parse(fs.readFileSync('scripts/verification/vps-fok-baseline.json'));
const sources=fixedManifestSources(manifest);
const read=file=>fs.readFileSync(file,'utf8');
describe('all original 551 VPS manifest entries remain protected',()=>{
  it('verifies every original entry, including the complete shared writer',()=>{
    const results=verifyManifestSources(manifest,read,sources);
    expect(results.map(row=>row.file)).toEqual(Object.keys(manifest.protectedFiles));
    expect(results).toHaveLength(551);
    expect(results.some(row=>row.file==='server/backend/core/account/order_store.js')).toBe(true);
  }, 30_000); // Complete 551-entry restoration exceeded the default 5 seconds in CI.
  it('cannot remove an original entry',()=>{const copy=structuredClone(manifest);delete copy.protectedFiles[Object.keys(copy.protectedFiles).at(-1)];expect(()=>verifyManifestSources(copy,read,sources)).toThrow();});
  it('cannot relabel the baseline',()=>expect(()=>verifyManifestSources({...manifest,version:'5eb63ba7f49156a4a98a1357a0888e1dcc0e9924'},read,sources)).toThrow());
  it('cannot accept substituted original source bytes',()=>{const copy={...sources};copy[Object.keys(copy)[0]]+='\nvoid hiddenTrade();';expect(()=>verifyManifestSources(manifest,read,copy)).toThrow('provenance');});
  for(const file of ['client/web/src/shared/orderLink.ts','packages/shared/currency.ts','server/backend/core/account/order_store.js',Object.keys(manifest.protectedFiles).at(-1)]) {
    it(`${file}: extra executable statement anywhere in the manifest is rejected`,()=>expect(()=>verifyManifestSources(manifest,requested=>read(requested)+(requested===file?'\nvoid unexpectedTradingAction();':''),sources)).toThrow());
  }
  for(const file of ['server/backend/core/orderModes/orderMetadata.js','server/backend/core/orderModes/saveRows.js']) {
    it(`${file}: full existing helper cannot introduce I/O or actions`,()=>expect(()=>verifyManifestSources(manifest,requested=>read(requested)+(requested===file?'\nvoid fetch("/new-query");':''),sources)).toThrow('committed mode helper'));
  }
  it('rejects baseline recording before any output or source writes',()=>{
    const before=fs.readFileSync('scripts/verification/vps-fok-baseline.json');
    const result=spawnSync(process.execPath,['scripts/verification/verify-vps-fok-baseline.mjs','--record-captured-release'],{encoding:'utf8',timeout:10000});
    expect(result.status).not.toBe(0);expect(result.stderr).toContain('recording');
    expect(fs.readFileSync('scripts/verification/vps-fok-baseline.json')).toEqual(before);
  });
  it('manifest still equals the committed immutable file',()=>expect(read('scripts/verification/vps-fok-baseline.json').replaceAll('\r\n','\n')).toBe(execFileSync('git',['show','5eb63ba7f49156a4a98a1357a0888e1dcc0e9924:scripts/verification/vps-fok-baseline.json'],{encoding:'utf8'}).replaceAll('\r\n','\n')));
});
