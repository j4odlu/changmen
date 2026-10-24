import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {describe, expect, it} from 'vitest';
import {historicalWorkspaceFs} from './workspace-layout-history.mjs';
import {BROWSER_ENTRY_RETIREMENT, browserHistorySha, restoreBrowserEntryRetirement} from './browser-entry-history.mjs';
import {verifyBrowserEntryRetirement, certifiedBrowserConsumerChanges} from './browser-entry-retirement.mjs';
import {restore9999CProbabilitySource, restore9999CProbabilityVerificationSource, verify9999CProbabilitySources} from './single-leg-9999-c-probability-boundary.mjs';

const normalize = source => source.replaceAll('\r\n', '\n');
const read = file => historicalWorkspaceFs.readFileSync(file, 'utf8');
const exists = file => historicalWorkspaceFs.existsSync(file);
const base = 'ed4a158c854d5b28093a76727a6c08081233af14';
const previous = file => normalize(execFileSync('git', ['show', `${base}:${file}`], {encoding: 'utf8'}));
const consumers = [
  'client/web/src/components/user/tabs/UserDiagExtensionsTab.vue',
  'client/web/src/stores/betting/autoBet/phases/prepareArbAttempt.ts',
];

describe('9999 C probability increment preserves immutable migration proofs', () => {
  it.each(consumers)('restores the complete previous %s without changing its original hash', file => {
    const source = normalize(read(file));
    const restored = restore9999CProbabilitySource(file, source);
    expect(restored).toBe(previous(file));
    const row = BROWSER_ENTRY_RETIREMENT.changes.findLast(row => row.file === file);
    expect(browserHistorySha(restored)).toBe(row.afterSha);
    expect(restore9999CProbabilitySource(file, restored)).toBe(restored);
    expect(restore9999CProbabilitySource(file, source.replaceAll('\n', '\r\n'))).toBe(restored);
    const original = BROWSER_ENTRY_RETIREMENT.changes.find(row => row.file === file);
    expect(browserHistorySha(restoreBrowserEntryRetirement(file, source))).toBe(original.beforeSha);
  });

  it('accepts the new feature while every old consumer snapshot and retired entry remains checked', () => {
    expect(verify9999CProbabilitySources(read)).toEqual({files: 4});
    expect(verifyBrowserEntryRetirement(read, exists).retired).toBe(595);
    const certified = certifiedBrowserConsumerChanges(read);
    for (const file of consumers) expect(certified.has(file)).toBe(true);
    const retired = BROWSER_ENTRY_RETIREMENT.retired[0];
    expect(() => verifyBrowserEntryRetirement(read, file => file === retired || exists(file)))
      .toThrow('retired browser entry must not return');
  });

  it.each(consumers)('does not erase unrelated edits to %s', file => {
    const source = normalize(read(file));
    const changed = `${source}\nvoid unrelatedOrderChange();\n`;
    expect(restore9999CProbabilitySource(file, changed)).toBe(changed);
    const editedRead = target => target === file ? changed : read(target);
    expect(() => verifyBrowserEntryRetirement(editedRead, exists)).toThrow('complete reviewed consumer change');
    expect(() => verify9999CProbabilitySources(editedRead)).toThrow('only the exact 9999 C probability change');
    expect(certifiedBrowserConsumerChanges(editedRead).has(file)).toBe(false);
  });

  it.each([
    ['remove the feature gate', 'if (prefs.singleLeg9999HigherCProbabilityOnly === true)', 'if (false)'],
    ['remove skipping', '        return null;', '        return undefined;'],
    ['change existing map-count behavior', 'reserveSingleLeg9999MapFillKeys(singleLeg9999MapKeys, maxPerMap)', 'true'],
  ])('rejects a mutation that would %s', (_name, before, after) => {
    const file = consumers[1];
    const source = normalize(read(file));
    expect(source).toContain(before);
    const changed = source.replace(before, after);
    const editedRead = target => target === file ? changed : read(target);
    expect(() => verifyBrowserEntryRetirement(editedRead, exists)).toThrow('complete reviewed consumer change');
    expect(() => verify9999CProbabilitySources(editedRead)).toThrow('only the exact 9999 C probability change');
  });

  it('checks the new helper, and rejects altered, missing or reverted feature sources', () => {
    const helper = 'client/web/src/extensions/arbBet/singleLeg9999CProbability.ts';
    expect(() => verify9999CProbabilitySources(file => file === helper ? read(file).replace('live > opposite', 'true') : read(file)))
      .toThrow('exact C probability filter implementation');
    expect(() => verify9999CProbabilitySources(file => file === consumers[0] ? previous(file) : read(file)))
      .toThrow('only the exact 9999 C probability change');
    expect(() => verify9999CProbabilitySources(file => {
      if (file === helper) throw Error('missing feature helper');
      return read(file);
    })).toThrow('missing feature helper');
    expect(restore9999CProbabilitySource('client/web/src/stores/betting/autoBet/phases/placeArbLegs.ts', 'unreviewed code'))
      .toBe('unreviewed code');
  });

  it('restores only the exact new preference field, default and normalizer', () => {
    const file = 'client/web/src/types/extensionPrefs.ts';
    const source = normalize(read(file));
    expect(restore9999CProbabilitySource(file, source)).toBe(previous(file));
    expect(restore9999CProbabilitySource(file, previous(file))).toBe(previous(file));
    for (const changed of [
      source.replace('singleLeg9999HigherCProbabilityOnly: false', 'singleLeg9999HigherCProbabilityOnly: true'),
      source.replace('singleLeg9999MaxPerMap: 1', 'singleLeg9999MaxPerMap: 20'),
      `${source}\nvoid unrelatedPreferenceChange();`,
    ]) {
      expect(restore9999CProbabilitySource(file, changed)).toBe(changed);
      expect(() => verify9999CProbabilitySources(target => target === file ? changed : read(target)))
        .toThrow('only the exact 9999 C probability change');
    }
  });

  it.each([
    'scripts/verification/browser-entry-history.mjs',
    'scripts/verification/browser-entry-retirement.mjs',
    'scripts/verification/workspace-layout-relocation.mjs',
    'scripts/verification/pm-unified-preflight-boundary.mjs',
  ])('only restores the exact new calls in %s', file => {
    const source = normalize(fs.readFileSync(file, 'utf8'));
    expect(restore9999CProbabilityVerificationSource(file, source)).toBe(previous(file));
    expect(restore9999CProbabilityVerificationSource(file, `${source}\nvoid skipGuard();`)).toBe(`${source}\nvoid skipGuard();`);
    expect(restore9999CProbabilityVerificationSource(file, previous(file))).toBe(previous(file));
  });
});
