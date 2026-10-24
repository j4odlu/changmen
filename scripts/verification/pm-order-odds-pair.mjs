// [changmen 扩展] 精确登记「提交赔率 / 成交赔率」UI，历史赔率与订单基线保持不变。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { restorePmSignedLimitDisplaySource } from "./pm-signed-limit-display.mjs";

const normalize = source => source.replaceAll("\r\n", "\n");
const sha = source => createHash("sha256").update(normalize(source)).digest("hex");
const text = fs.readFileSync(new URL("./pm-order-odds-pair-increments.json", import.meta.url), "utf8");
const EXPECTED_SHA = "fa4e19e7348bc5e3ee1876b1012d3277af6c99a508069ab0d282f358e509b176";
assert.equal(sha(text), EXPECTED_SHA, "PM odds pair display inventory changed");
export const PM_ORDER_ODDS_PAIR = JSON.parse(text);

export function restorePmOrderOddsPairSource(file, source) {
  source = restorePmSignedLimitDisplaySource(file, source);
  const row = PM_ORDER_ODDS_PAIR.files.find(item => item.file === file);
  if (!row || sha(source) !== row.afterSha)
    return source;
  const text = normalize(source), { offset, before, after } = row.edit;
  assert.equal(text.slice(offset, offset + after.length), after, `${file}: exact odds pair display increment`);
  const restored = text.slice(0, offset) + before + text.slice(offset + after.length);
  assert.equal(sha(restored), row.beforeSha, `${file}: complete source before odds pair display must restore`);
  return restored;
}
