// [changmen 扩展] 三个接入点逐字还原；沿用既有固定 FOK/VPS 哈希，不豁免任何原模块。
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { restorePmSharedStreamSource, verifyPmSharedStreamContract } from "./pm-shared-stream-boundary.mjs";
import { restorePmExecutionShadowSource, verifyPmExecutionShadowContract } from "./pm-execution-shadow-boundary.mjs";
const normalize = value => value.replaceAll("\r\n", "\n");
const digest = value => createHash("sha256").update(normalize(value)).digest("hex");
const text = normalize(fs.readFileSync(new URL("./pm-ws-shadow-increments.json", import.meta.url), "utf8"));
assert.equal(digest(text), "0c57830c084d16e0a5b5f6afa645c8490fa4b01308634eab35079ced389cabd7", "reviewed WS shadow increments stay fixed");
const { changes } = JSON.parse(text);
export function restorePmWsShadowSource(file, source, required = false) {
  source = restorePmExecutionShadowSource(file, source);
  source = restorePmSharedStreamSource(file, source);
  const row = changes[file];
  if (!row) return source;
  let restored = normalize(source);
  if (!required && !row.increments.some(([, after]) => restored.includes(after))) return restored;
  for (const [before, after] of row.increments) {
    assert.equal(restored.split(after).length, 2, file + ": exact shadow-only increment");
    restored = restored.replace(after, before);
  }
  return restored;
}
export function verifyPmWsShadowContract(read) {
  verifyPmExecutionShadowContract(read);
  verifyPmSharedStreamContract(read);
  for (const [file, row] of Object.entries(changes))
    assert.equal(digest(restorePmWsShadowSource(file, read(file), true)), row.beforeSha, file + ": original source outside shadow hooks unchanged");
}
