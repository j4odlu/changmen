import {readAdapterHistory} from "./browser-entry-history.mjs";
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { restoreMakeupOddsDisplaySource } from './makeup-odds-display-boundary.mjs';
const commit = '4a553bbb1ed34cb59486ae5030f81cdab5656cf7';
const read = file => readAdapterHistory(file, 'utf8').replaceAll('\r\n', '\n');
const files = ['client/web/src/shared/orderLink.ts', 'client/web/src/components/order/OrderList.vue'];

it.each(files)('restores the complete pre-display source without changing its historical baseline: %s', file => {
  const before = execFileSync('git', ['show', `${commit}^:${file}`], { encoding: 'utf8', windowsHide: true }).replaceAll('\r\n', '\n');
  expect(restoreMakeupOddsDisplaySource(file, read(file))).toBe(before);
  expect(restoreMakeupOddsDisplaySource(file, before)).toBe(before);
});

it.each(files)('rejects altered presentation, partial increments and unrelated appended logic: %s', file => {
  const current = read(file);
  expect(current).toContain('MakeupOddsBand');
  expect(() => restoreMakeupOddsDisplaySource(file, current.replace('MakeupOddsBand', 'UnexpectedBand'))).toThrow();
  expect(() => restoreMakeupOddsDisplaySource(file, current + '\nvoid unexpectedTrade();')).toThrow();
});

it('rejects changes to the existing DisplayOnly financial and operation guards', () => {
  const link = files[0], list = files[1];
  const linkGuard = 'if (row.DisplayOnly)\n    return false;';
  expect(read(link)).toContain(linkGuard);
  expect(() => restoreMakeupOddsDisplaySource(link, read(link).replace(linkGuard, 'if (row.DisplayOnly)\n    return true;'))).toThrow();
  const listGuard = 'if (row.DisplayOnly)\n    return;';
  expect(read(list)).toContain(listGuard);
  expect(() => restoreMakeupOddsDisplaySource(list, read(list).replace(listGuard, ''))).toThrow();
});

it('does not transform unrelated files', () => {
  expect(restoreMakeupOddsDisplaySource('unrelated.ts', 'MakeupOddsBand')).toBe('MakeupOddsBand');
});
