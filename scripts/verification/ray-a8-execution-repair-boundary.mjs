// [changmen 扩展] 用户确认的 RAY 完整链路对齐与空盘口修复；原迁移和预检证明不变。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {restoreArbMakeUpPolicySource} from './arb-makeup-policy-boundary.mjs';
import {restoreVenueChunkPolicySource, verifyVenueChunkPolicySources} from './venue-chunk-policy-boundary.mjs';
const normalize = source => source.replaceAll('\r\n', '\n');
const sha = source => createHash('sha256').update(normalize(source)).digest('hex');
const text = fs.readFileSync(new URL('./ray-a8-execution-repair-increments.json', import.meta.url), 'utf8');
assert.equal(sha(text), '6a80450cda4962ca7470acd8dd7ceaeda9044316cf97f5d2d8d2936d9247fbae', 'RAY execution repair evidence changed');
const inventory = JSON.parse(text);
assert.equal(inventory.baseline, 'dcf46f77781c9ac1eaebefa2ab2948cbfcf073f1');
const entries = new Map(inventory.files.map(row => [row.file, row]));
export function restoreRayExecutionRepairSource(file, source) {
  // 后续构建配置先精确还原；原迁移证明和交易源码基线保持。
  source = restoreVenueChunkPolicySource(file, source);
  // 后续纯提取先精确还原，再继续核对原迁移与预检基线。
  source = restoreArbMakeUpPolicySource(file, source);
  const row = entries.get(file);
  if (!row || sha(source) !== row.afterSha) return source;
  source = normalize(source);
  for (const edit of [...row.changes].reverse()) {
    assert.equal(source.slice(edit.afterOffset, edit.afterOffset + edit.after.length), edit.after, `${file}: exact execution repair`);
    source = source.slice(0, edit.afterOffset) + edit.before + source.slice(edit.afterOffset + edit.after.length);
  }
  assert.equal(sha(source), row.beforeSha, `${file}: original pre-repair source must restore`);
  return source;
}
export function verifyRayExecutionRepairSources(read) {
  verifyVenueChunkPolicySources(read);
  for (const row of entries.values())
    assert.equal(sha(read(row.file)), row.afterSha, `${row.file}: only the exact RAY A8 precheck change is authorized (execution repair)`);
  return {files: entries.size};
}
