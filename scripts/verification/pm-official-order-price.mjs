// [changmen 扩展] 只登记官方订单 price 的读取、传递和显示修正，不改变历史基线。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";

const normalize = source => source.replaceAll("\r\n", "\n");
const sha = source => createHash("sha256").update(normalize(source)).digest("hex");
const text = fs.readFileSync(new URL("./pm-official-order-price-increments.json", import.meta.url), "utf8");
assert.equal(sha(text), "4943ab99f00348e535665251434fa33819bfe3604525c691b7c17598e7ae2632", "PM official order price inventory changed");
export const PM_OFFICIAL_ORDER_PRICE = JSON.parse(text);

export function restorePmOfficialOrderPriceSource(file, source) {
  const row = PM_OFFICIAL_ORDER_PRICE.files.find(item => item.file === file);
  if (!row || sha(source) !== row.afterSha) return source;
  const text = normalize(source), { offset, before, after } = row.edit;
  assert.equal(text.slice(offset, offset + after.length), after, `${file}: exact official order price increment`);
  const restored = text.slice(0, offset) + before + text.slice(offset + after.length);
  assert.equal(sha(restored), row.beforeSha, `${file}: source before official order price must restore`);
  return restored;
}

export function verifyPmOfficialOrderPriceSources(read = file => fs.readFileSync(new URL("../../" + file, import.meta.url), "utf8")) {
  for (const row of PM_OFFICIAL_ORDER_PRICE.files) {
    assert.equal(sha(read(row.file)), row.afterSha, `${row.file}: unregistered official order price change`);
    assert.equal(sha(restorePmOfficialOrderPriceSource(row.file, read(row.file))), row.beforeSha);
  }
}
