// [changmen 扩展] 按账号隔离钱包签名会话；精确还原后继续核验既有 FOK/GTC 基线。
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { restorePmPreflightLabels } from "./pm-preflight-labels-boundary.mjs";
import { restorePmFastFokSource, verifyPmFastFokContract } from "./pm-fast-fok-boundary.mjs";
const normalize = value => value.replaceAll("\r\n", "\n");
const digest = value => createHash("sha256").update(normalize(value)).digest("hex");
const text = normalize(fs.readFileSync(new URL("./pm-account-signing-increments.json", import.meta.url), "utf8"));
assert.equal(digest(text), "f3b171df1c0fc0346c51e1835d2e6b18e3e7d43f47bc6f4424a9877a175ebad0", "account signing isolation increments stay fixed");
const { changes } = JSON.parse(text);

export function restorePmAccountSigningSource(file, source, required = false) {
  source = restorePmFastFokSource(file, source);
  source = restorePmPreflightLabels(file, source);
  const row = changes[file];
  if (!row) return source;
  let restored = normalize(source);
  if (!required && !row.increments.some(([, after]) => restored.includes(after))) return restored;
  for (const [before, after] of row.increments) {
    assert.equal(restored.split(after).length, 2, file + ": exact account signing isolation increment");
    restored = restored.replace(after, before);
  }
  return restored;
}

export function verifyPmAccountSigningContract(read) {
  verifyPmFastFokContract(read);
  for (const [file, row] of Object.entries(changes))
    assert.equal(digest(restorePmAccountSigningSource(file, read(file), true)), row.beforeSha,
      file + ": original implementation unchanged outside account signing isolation");
}
