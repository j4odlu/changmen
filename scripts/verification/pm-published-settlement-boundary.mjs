import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
// [changmen 扩展] 精确核对已发布 113db6ff 的三个结算模块，并逐 hunk 还原至发布前源码。
// 原 FOK/VPS 基线及清单独立保留；不提供任意提交、文件或模式的豁免。
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { restorePmOrderBetLabelSource } from './pm-order-bet-label-boundary.mjs';
import { restorePmPreflightSource } from './pm-preflight-boundary.mjs';
import { restoreVenueBrowserQuotes } from './venue-browser-quotes.mjs';

export const publishedPmCommit = '113db6ff4e59dd615f8dd867e11d859b05766b7d';
// [changmen 扩展] 精确登记已提交的官方优先/价格回退修复，含手动卖出已实现盈亏保护。
export const priceFallbackCommit = '109eff8d70f7f41e6a0374b9f5bef431548779b5';
const previousPmCommit = '5eb63ba7f49156a4a98a1357a0888e1dcc0e9924';
export const publishedSettlementFiles = Object.freeze([
  'packages/venue-adapter/polymarket/orders/history/orders.ts',
  'packages/venue-adapter/polymarket/markets/pmMarketGuard.ts',
  'server/backend/core/integrations/polymarket/settlement.js',
]);
export const priceFallbackFiles = Object.freeze([
  ...publishedSettlementFiles,
  'packages/venue-adapter/polymarket/submission/pmManualSell.ts',
]);
const normal = source => source.replaceAll('\r\n', '\n');
const cache = new Map();
const git = args => execFileSync('git', ['--no-optional-locks', ...args], {
  encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, windowsHide: true,
});

function reviewedModule(file, before = previousPmCommit, after = publishedPmCommit) {
  const key = `${before}:${after}:${file}`;
  if (!cache.has(key)) {
    const original = normal(git(['show', `${before}:${file}`]));
    const published = normal(git(['show', `${after}:${file}`]));
    const diff = git(['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--no-color', '--text', '--unified=0', before, after, '--', file]);
    const hunks = []; let hunk;
    for (const line of normal(diff).split('\n')) {
      const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (match) {
        hunk = { oldStart: Number(match[1]), oldCount: Number(match[2] ?? 1), newStart: Number(match[3]), newCount: Number(match[4] ?? 1), before: [], after: [] };
        hunks.push(hunk);
      } else if (hunk && line.startsWith('-')) hunk.before.push(line.slice(1));
      else if (hunk && line.startsWith('+')) hunk.after.push(line.slice(1));
      else if (hunk) assert(line === '' || line.startsWith('\\ No newline'), `${file}: unexpected reviewed diff line`);
    }
    assert(hunks.length > 0, `${file}: missing reviewed published change`);
    for (const h of hunks) {
      assert.equal(h.before.length, h.oldCount, `${file}: complete original hunk`);
      assert.equal(h.after.length, h.newCount, `${file}: complete published hunk`);
    }
    cache.set(key, { original, published, hunks });
  }
  return cache.get(key);
}

function restoreReviewedModule(file, source, { original, published, hunks }) {
  assert.equal(normal(source), published, `${file}: complete actual published PM module must remain unchanged`);
  const lines = normal(source).split('\n');
  for (const hunk of [...hunks].reverse()) {
    const index = hunk.newCount ? hunk.newStart - 1 : hunk.newStart;
    assert.deepEqual(lines.slice(index, index + hunk.newCount), hunk.after, `${file}: exact published hunk`);
    lines.splice(index, hunk.newCount, ...hunk.before);
  }
  const restored = lines.join('\n');
  assert.equal(restored, original, `${file}: complete original module after all reviewed hunks`);
  return restored;
}

export function restorePublishedPmSettlement(file, source) {
  source = restoreVenueBrowserQuotes(file, source);
  if (priceFallbackFiles.includes(file)) source = restorePmPreflightSource(file, source);
  source = restorePmOrderBetLabelSource(file, source, target => readAdapterHistory(target, 'utf8'));
  if (priceFallbackFiles.includes(file)) {
    const reviewed = reviewedModule(file, publishedPmCommit, priceFallbackCommit);
    // 历史包仍按原登记核验；当前包先完整证明新修复，再逐 hunk 恢复旧登记。
    if (normal(source) !== reviewed.original)
      source = restoreReviewedModule(file, source, reviewed);
  }
  if (!publishedSettlementFiles.includes(file)) return source;
  return restoreReviewedModule(file, source, reviewedModule(file));
}
