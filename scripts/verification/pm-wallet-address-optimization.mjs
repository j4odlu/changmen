import { restorePmSdkRetirementSource } from "./pm-sdk-retirement.mjs";
// [changmen 扩展] Exact offline inverse for the native ESM wallet-address implementation.
// Historical inventories stay immutable; current runtime and dynamic imports are checked separately.
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
const sha = source => createHash("sha256").update(source.replaceAll("\r\n", "\n")).digest("hex");
const nativeRead = file => fs.readFileSync(new URL("../../" + file, import.meta.url), "utf8");
const text = fs.readFileSync(new URL("./pm-wallet-address-optimization.json", import.meta.url), "utf8");
assert.equal(sha(text), "186e769879797198680731ac2c7f26e83e67c22a67ac3a23eacdd48728d374c8", "Wallet address optimization inventory changed");
export const PM_WALLET_ADDRESS_OPTIMIZATION = JSON.parse(text);
const record = PM_WALLET_ADDRESS_OPTIMIZATION;
assert.equal(record.purpose, "native-esm-deposit-wallet-address-only");
for (const row of record.files) assert.equal(sha(row.before), row.beforeSha, "Original wallet source changed");
export const pmWalletAddressOptimizationFiles = new Set(record.files.map(row => row.file));
function verifyAssets(read) {
  for (const row of record.assets) assert.equal(sha(read(row.file)), row.sha, row.file + ": wallet derivation implementation changed");
}
export function restorePmWalletAddressOptimizationSource(file, source, read = nativeRead) {
  source = restorePmSdkRetirementSource(file, source, read);
  const row = record.files.find(row => row.file === file);
  if (!row || sha(source) !== row.afterSha) return source;
  verifyAssets(read);
  return row.before;
}
export function verifyPmWalletAddressOptimization(read = nativeRead) {
  verifyAssets(read);
  for (const row of record.files) assert.equal(sha(restorePmSdkRetirementSource(row.file, read(row.file), read)), row.afterSha, row.file + ": unreviewed wallet optimization");
  return { files: record.files.length, assets: record.assets.length };
}
