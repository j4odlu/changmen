import {adapterCanonicalFile} from "./browser-entry-history.mjs";
import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
import { restoreVenueBrowserExecution } from "./venue-browser-execution.mjs";
// [changmen 扩展] 已发布 PM 改动保留、精确还原及越界负向；不执行数据库/交易/Git 写入。
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { priceFallbackCommit, priceFallbackFiles, publishedPmCommit, publishedSettlementFiles, restorePublishedPmSettlement } from './pm-published-settlement-boundary.mjs';
import { verifyProtectedSource } from './fok-exact-boundaries.mjs';
import { deployedSource, immutableBaselines, verifyPhase2Module } from './orders-phase2-release-boundary.mjs';
import { restorePmOrderBetLabelSource } from './pm-order-bet-label-boundary.mjs';
const previous = '5eb63ba7f49156a4a98a1357a0888e1dcc0e9924';
const normal = text => text.replaceAll('\r\n', '\n');
const readBeforeExecution = withAdapterHistoryReader(file => normal(readAdapterHistory(file, 'utf8')));
const read = file => restoreVenueBrowserExecution(file, readBeforeExecution(file));
const cache = new Map();
const source = (base, file) => {
  const key = `${base}:${file}`;
  if (!cache.has(key)) cache.set(key, normal(execFileSync('git', ['--no-optional-locks', 'show', key], { encoding: 'utf8' })));
  return cache.get(key);
};

describe('preserve the exact already deployed PM release', () => {
  it('aligns the application source without replacing either immutable FOK/VPS baseline', () => {
    expect(deployedSource).toBe(publishedPmCommit);
    expect(immutableBaselines).toEqual(['219535c8', '75b1efac66625e5f2bc9884a965b244bfaf337ed']);
    const digest = createHash('sha256').update(read('scripts/verification/vps-fok-baseline.json')).digest('hex');
    expect(digest).toBe('6791e39190c5b0836ad1b92750ad88d62256d7fa1eecbdb99b40c4839204f1e9');
  });
  it('retains all 19 published paths, including their original published protection tools', () => {
    const paths = execFileSync('git', ['--no-optional-locks', 'diff', '--no-renames', '--name-only', '-z', previous, publishedPmCommit, '--'], { encoding: 'utf8' }).split('\0').filter(Boolean);
    expect(paths).toHaveLength(19);
    const scope = JSON.parse(source('313c19e8afc30d62b54363830974b6738eab84d8','scripts/verification/orders-phase2-release-scope.json'));
    for (const file of paths) {
      expect(fs.existsSync(adapterCanonicalFile(file)), file).toBe(true);
      expect(source('313c19e8afc30d62b54363830974b6738eab84d8',file), file).toBe(source(publishedPmCommit, file));
      expect(Object.hasOwn(scope.allowedFiles, file), 'published path must not be overwritten by the compatibility overlay').toBe(false);
    }
  });
  it('keeps the existing execution state machine on the old authoritative table', () => {
    const file = 'server/db/rds/orderModes/gtc/pm_gtc_store.js';
    expect(source(previous, file)).toBe(source(publishedPmCommit, file));
    const historicalRead=path=>source('313c19e8afc30d62b54363830974b6738eab84d8',path);
    expect(verifyPhase2Module(file,historicalRead(file),historicalRead).passed).toBe(true);
    expect(read(file)).toContain('UPDATE pm_gtc_executions SET record');
  });
  for (const file of publishedSettlementFiles) {
    it(`${file}: restores every reviewed hunk and the complete preceding module`, () => {
      expect(restorePublishedPmSettlement(file, read(file))).toBe(source(previous, file));
      expect(restorePublishedPmSettlement(file, read(file).replaceAll('\n', '\r\n'))).toBe(source(previous, file));
      expect(restorePmOrderBetLabelSource(file, read(file), read)).toBe(source(priceFallbackCommit, file));
      expect(restorePublishedPmSettlement(file, source(publishedPmCommit, file))).toBe(source(previous, file));
    });
    it(`${file}: rejects an appended action`, () => expect(() => restorePublishedPmSettlement(file, read(file) + '\nvoid unexpectedOrderWrite();\n')).toThrow('complete actual published'));
    it(`${file}: rejects an action before the known reviewed fragments`, () => expect(() => restorePublishedPmSettlement(file, 'void unexpectedOrderWrite();\n' + read(file))).toThrow('complete actual published'));
    it(`${file}: rejects a stale full implementation`, () => expect(() => restorePublishedPmSettlement(file, source(previous, file))).toThrow('complete actual published'));
    it(`${file}: rejects edits even to a published comment`, () => expect(() => restorePublishedPmSettlement(file, read(file).replace('官方', '未经确认'))).toThrow('complete actual published'));
  }
  const logical = [
    ['packages/venue-adapter/polymarket/orders.ts', 'packages/venue-adapter/polymarket/orders/history/orders.ts'],
    ['packages/venue-adapter/polymarket/pmMarketGuard.ts', 'packages/venue-adapter/polymarket/markets/pmMarketGuard.ts'],
    ['packages/venue-adapter/polymarket/pmManualSell.ts', 'packages/venue-adapter/polymarket/submission/pmManualSell.ts'],
    ['server/backend/core/integrations/polymarket/settlement.js', 'server/backend/core/integrations/polymarket/settlement.js'],
  ];
  for (const [file, implementation] of logical) for (const base of immutableBaselines) {
    it(`${file}: still validates its complete ${base} original source`, () => {
      expect(verifyProtectedSource(file, read(file), source(base, file), read, target => source(base, target)).file).toBe(file);
    });
    it(`${file}: ${base} rejects tampering behind the compatibility entry`, () => {
      const mutatedRead = target => read(target) + (target === implementation ? '\nvoid unexpectedOrderWrite();\n' : '');
      expect(() => verifyProtectedSource(file, file === implementation ? mutatedRead(file) : read(file), source(base, file), mutatedRead, target => source(base, target))).toThrow();
    });
  }
  it('supports exactly the three reviewed physical modules', () => expect(publishedSettlementFiles).toHaveLength(3));
  it('registers exactly four complete price-fallback modules without widening the historical baseline', () => {
    expect(priceFallbackFiles).toEqual([...publishedSettlementFiles, 'packages/venue-adapter/polymarket/submission/pmManualSell.ts']);
    for (const file of priceFallbackFiles) {
      const restored = restorePublishedPmSettlement(file, read(file));
      expect(restored).toBe(source(publishedSettlementFiles.includes(file) ? previous : publishedPmCommit, file));
      expect(() => restorePublishedPmSettlement(file, read(file) + '\nvoid unexpectedTradingAction();\n')).toThrow('complete actual published');
    }
  });
  it('manual-sell realization edits remain blocked by both original FOK/VPS baselines', () => {
    const file = 'packages/venue-adapter/polymarket/pmManualSell.ts';
    const implementation = 'packages/venue-adapter/polymarket/submission/pmManualSell.ts';
    const original = read(implementation);
    expect(original).toContain('const prevRealizedUsdc');
    const modified = original.replace('const prevRealizedUsdc', 'const unreviewedRealizedUsdc');
    for (const base of immutableBaselines) {
      const mutatedRead = target => target === implementation ? modified : read(target);
      expect(() => verifyProtectedSource(file, read(file), source(base, file), mutatedRead, target => source(base, target))).toThrow();
    }
  });
  it('leaves unrelated changes visible to their original protection', () => {
    const file = 'packages/venue-adapter/polymarket/gtc/index.ts';
    const text = 'void unexpectedOrderWrite();\n';
    expect(restorePublishedPmSettlement(file, text)).toBe(text);
    expect(() => verifyProtectedSource('server/backend/core/account/order_store.js', read('server/backend/core/account/order_store.js') + text, source(immutableBaselines[1], 'server/backend/core/account/order_store.js'), read)).toThrow();
  });
});
