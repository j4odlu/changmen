import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
// [changmen 扩展] 仅还原用户要求的拒单报价展示和数量快照透传；不豁免下单/核验逻辑。
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { restoreMakeupOddsDisplaySource } from "./makeup-odds-display-boundary.mjs";
const normalize = source => source.replaceAll("\r\n", "\n");
const digest = source => createHash("sha256").update(normalize(source)).digest("hex");
const text = normalize(readAdapterHistory(new URL("./pm-reject-display-increments.json", import.meta.url), "utf8"));
assert.equal(digest(text), "5e17aeedd0b81f6b9a062778594b234a2431a1144b39e602c6607e307a656140", "fixed PM reject display increments");
const registered = JSON.parse(text);

export function restorePmRejectDisplaySource(file, source, required = false) {
  source = restoreMakeupOddsDisplaySource(file, source);
  const row = registered.changes[file];
  if (!row) return source;
  let restored = normalize(source);
  // 已由其它历史变换还原的源码仍交原完整基线检查，不重复处理本次增量。
  if (!required && !row.increments.some(([, after]) => restored.includes(after))) return restored;
  for (const [before, after] of row.increments) {
    assert.equal(restored.split(after).length, 2, file + ": exact reject display increment");
    restored = restored.replace(after, before);
  }
  assert.equal(digest(restored), row.beforeSha, file + ": complete source outside reject display change");
  return restored;
}

export function verifyPmRejectDisplayContract(read) {
  for (const file of Object.keys(registered.changes)) restorePmRejectDisplaySource(file, read(file), true);
}
