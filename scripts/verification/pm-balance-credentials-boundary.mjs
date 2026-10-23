// [changmen 扩展] 仅还原用户授权的 PM 凭据日志与余额修复增量，原迁移和 A8/FOK 基线保持。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';

const normalize = source => source.replaceAll('\r\n', '\n');
export const pmFundingSha = source => createHash('sha256').update(normalize(source)).digest('hex');
const text = fs.readFileSync(new URL('./pm-balance-credentials-increments.json', import.meta.url), 'utf8');
assert.equal(pmFundingSha(text), "aca91d789ab8f4ac5fc020a6027b520ed98ccd53243ee412ee27470e8f813340", 'PM balance/credentials exact increments changed');
export const PM_BALANCE_CREDENTIALS = JSON.parse(text);
const files = new Map(PM_BALANCE_CREDENTIALS.files.map(row => [row.file, row]));
export const pmBalanceCredentialFiles = new Set(files.keys());

export function restorePmBalanceCredentialsSource(file, source) {
  const row = files.get(file);
  if (!row || pmFundingSha(source) !== row.afterSha) return source;
  source = normalize(source);
  for (const edit of [...row.changes].reverse()) {
    assert.equal(source.slice(edit.offset, edit.offset + edit.after.length), edit.after, file + ': exact PM funding repair');
    source = source.slice(0, edit.offset) + edit.before + source.slice(edit.offset + edit.after.length);
  }
  assert.equal(pmFundingSha(source), row.beforeSha, file + ': entire pre-repair source must restore');
  return source;
}

export function verifyPmBalanceCredentialsSources(read = file => fs.readFileSync(new URL('../../' + file, import.meta.url), 'utf8')) {
  for (const row of files.values()) {
    const source = read(row.file);
    assert.equal(pmFundingSha(source), row.afterSha, row.file + ': only the exact PM balance/credentials repair is authorized');
    assert.equal(pmFundingSha(restorePmBalanceCredentialsSource(row.file, source)), row.beforeSha);
  }
  for (const row of PM_BALANCE_CREDENTIALS.added)
    assert.equal(pmFundingSha(read(row.file)), row.sha, row.file + ': complete added PM funding implementation');
  return {files: files.size, added: PM_BALANCE_CREDENTIALS.added.length};
}
