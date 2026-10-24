// [changmen 扩展] 精确登记签单数量保存及赔率展示，保留历史下单与订单基线。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";

const normalize = source => source.replaceAll("\r\n", "\n");
const sha = source => createHash("sha256").update(normalize(source)).digest("hex");
const text = fs.readFileSync(new URL("./pm-signed-limit-display-increments.json", import.meta.url), "utf8");
assert.equal(sha(text), "7046a3fc81738d5472c861a577f006631768e37b9490a8e1a4bc8a4cc6b7827d", "PM signed-limit display inventory changed");
export const PM_SIGNED_LIMIT_DISPLAY = JSON.parse(text);

export function restorePmSignedLimitDisplaySource(file, source) {
  const row = PM_SIGNED_LIMIT_DISPLAY.files.find(item => item.file === file);
  if (!row || sha(source) !== row.afterSha)
    return source;
  const text = normalize(source), { offset, before, after } = row.edit;
  assert.equal(text.slice(offset, offset + after.length), after, `${file}: exact signed-limit display increment`);
  const restored = text.slice(0, offset) + before + text.slice(offset + after.length);
  assert.equal(sha(restored), row.beforeSha, `${file}: complete source before signed-limit display must restore`);
  return restored;
}

export function verifyPmSignedLimitDisplaySources(read = file => fs.readFileSync(new URL("../../" + file, import.meta.url), "utf8")) {
  for (const row of PM_SIGNED_LIMIT_DISPLAY.files) {
    const source = read(row.file);
    assert.equal(sha(source), row.afterSha, `${row.file}: unregistered signed-limit display change`);
    assert.equal(sha(restorePmSignedLimitDisplaySource(row.file, source)), row.beforeSha);
  }
}
