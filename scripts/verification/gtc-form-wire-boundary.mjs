// [changmen 扩展] 只登记 GTC 表单解码修复；还原后继续校验原始完整源码指纹。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
const registered = fs.readFileSync(new URL("./gtc-form-wire-increments.json", import.meta.url), "utf8").replaceAll("\r\n", "\n");
assert.equal(createHash("sha256").update(registered).digest("hex"), "30e1e45b23426593df9a3450e7eeba039491a4b24d9cac8582b37c7f8fcd9d65");
const increments = JSON.parse(registered);
export function restoreGtcFormWireSource(file, source) {
  source = source.replaceAll("\r\n", "\n");
  for (const [before, after] of increments[file] ?? []) {
    assert.equal(source.split(`${after}\n`).length, 2, `${file}: complete reviewed GTC form decoding increment`);
    source = source.replace(`${after}\n`, before ? `${before}\n` : "");
  }
  return source;
}
