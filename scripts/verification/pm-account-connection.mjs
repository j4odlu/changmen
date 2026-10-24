// [changmen 扩展] 逐文件认证 PM 连接界面增量，旧提取、迁移与 FOK 基线保持不变。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";

const normalize = source => source.replaceAll("\r\n", "\n");
const sha = source => createHash("sha256").update(normalize(source)).digest("hex");
const text = fs.readFileSync(new URL("./pm-account-connection-increments.json", import.meta.url), "utf8");
assert.equal(sha(text), "91f60bf472b428c99e1d9fdd8b58153cde8be6f5b1bcd9e7e4d3385597747125", "PM account connection inventory changed");
export const PM_ACCOUNT_CONNECTION = JSON.parse(text);

export function restorePmAccountConnectionSource(file, source) {
  const row = PM_ACCOUNT_CONNECTION.files.find(row => row.file === file);
  if (!row || sha(source) !== row.afterSha) return source;
  for (const asset of PM_ACCOUNT_CONNECTION.assets)
    assert.equal(sha(fs.readFileSync(new URL("../../" + asset.file, import.meta.url), "utf8")), asset.sha, "PM connection implementation changed");
  const current = normalize(source), { offset, before, after } = row.edit;
  assert.equal(current.slice(offset, offset + after.length), after, file + ": exact PM connection increment");
  const restored = current.slice(0, offset) + before + current.slice(offset + after.length);
  assert.equal(sha(restored), row.beforeSha, file + ": complete source before PM connection change must restore");
  return restored;
}

export function verifyPmAccountConnectionSources(read = file => fs.readFileSync(new URL("../../" + file, import.meta.url), "utf8")) {
  for (const row of PM_ACCOUNT_CONNECTION.files) {
    assert.equal(sha(read(row.file)), row.afterSha, row.file + ": unregistered PM connection change");
    assert.equal(sha(restorePmAccountConnectionSource(row.file, read(row.file))), row.beforeSha);
  }
  for (const asset of PM_ACCOUNT_CONNECTION.assets)
    assert.equal(sha(read(asset.file)), asset.sha, "PM connection implementation changed");
}
