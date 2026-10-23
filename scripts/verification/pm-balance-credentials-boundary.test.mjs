import {test} from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PM_BALANCE_CREDENTIALS,pmFundingSha,restorePmBalanceCredentialsSource,verifyPmBalanceCredentialsSources} from './pm-balance-credentials-boundary.mjs';
const read = file => fs.readFileSync(new URL('../../' + file, import.meta.url), 'utf8');

test('exact PM funding repair restores every complete original source', () => {
  assert.deepEqual(verifyPmBalanceCredentialsSources(read), {files: PM_BALANCE_CREDENTIALS.files.length, added: 2});
  for (const row of PM_BALANCE_CREDENTIALS.files)
    assert.equal(pmFundingSha(restorePmBalanceCredentialsSource(row.file, read(row.file))), row.beforeSha);
});
test('an extra edit or reverting a registered repair remains rejected', () => {
  for (const row of PM_BALANCE_CREDENTIALS.files) {
    assert.throws(() => verifyPmBalanceCredentialsSources(file => file === row.file ? read(file) + '\n// unreviewed edit\n' : read(file)));
    assert.throws(() => verifyPmBalanceCredentialsSources(file => file === row.file ? restorePmBalanceCredentialsSource(file, read(file)) : read(file)));
  }
});
test('added implementation cannot be changed through a folder exemption', () => {
  for (const row of PM_BALANCE_CREDENTIALS.added)
    assert.throws(() => verifyPmBalanceCredentialsSources(file => file === row.file ? read(file) + '\n' : read(file)));
});
