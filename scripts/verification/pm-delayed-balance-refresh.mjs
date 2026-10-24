// [changmen 扩展] 仅还原延迟确认后的余额补刷增量，保留原有历史基线和完整源码校验。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";

const normalize = source => source.replaceAll("\r\n", "\n");
const sha = source => createHash("sha256").update(normalize(source)).digest("hex");
const text = fs.readFileSync(new URL("./pm-delayed-balance-refresh-increment.json", import.meta.url), "utf8");
assert.equal(sha(text), "29c2207842bd778c2ff5cde67af3f65eb6a7e958091d3525ea404562e8811e95", "PM delayed balance refresh inventory changed");
export const PM_DELAYED_BALANCE_REFRESH = JSON.parse(text);

export function restorePmDelayedBalanceRefreshSource(file, source) {
  const row = PM_DELAYED_BALANCE_REFRESH;
  if (file !== row.file || sha(source) !== row.afterSha) return source;
  const current = normalize(source), { offset, before, after } = row.edit;
  assert.equal(current.slice(offset, offset + after.length), after, "Exact delayed balance refresh increment");
  const restored = current.slice(0, offset) + before + current.slice(offset + after.length);
  assert.equal(sha(restored), row.beforeSha, "Complete source before delayed balance refresh must restore");
  return restored;
}

export function verifyPmDelayedBalanceRefreshSource(read = file => fs.readFileSync(new URL("../../" + file, import.meta.url), "utf8")) {
  const row = PM_DELAYED_BALANCE_REFRESH;
  const source = read(row.file);
  assert.equal(sha(source), row.afterSha, "Unregistered delayed balance refresh change");
  assert.equal(sha(restorePmDelayedBalanceRefreshSource(row.file, source)), row.beforeSha);
}
