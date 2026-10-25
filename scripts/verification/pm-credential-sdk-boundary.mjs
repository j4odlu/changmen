// [changmen 扩展] Exact browser L1 signer migration only; historical baselines stay intact.
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { restoreMatcherLifecycleVerificationSource } from "./matcher-lifecycle-boundary.mjs";

const normalize = source => source.replaceAll("\r\n", "\n");
export const pmCredentialSdkSha = source => createHash("sha256").update(normalize(source)).digest("hex");
const text = fs.readFileSync(new URL("./pm-credential-sdk-increments.json", import.meta.url), "utf8");
assert.equal(pmCredentialSdkSha(text), "6127dc88660a4accb6a11bfcdf17a1b5a377f79751d7cac3782ef00b82c3c120", "PM credential SDK increments changed");
export const PM_CREDENTIAL_SDK = JSON.parse(text);
const files = new Map(PM_CREDENTIAL_SDK.files.map(row => [row.file, row]));
export const pmCredentialSdkFiles = new Set(files.keys());
const retired = new Map(PM_CREDENTIAL_SDK.retired.map(row => [row.file, row]));
export const pmCredentialSdkRetiredFiles = new Set(retired.keys());

// Historical source proofs only. Native Node imports still see the file as deleted.
export function readRetiredPmCredentialSdkSource(file) {
  const row = retired.get(file);
  if (!row) return undefined;
  assert(!fs.existsSync(new URL("../../" + file, import.meta.url)), file + ": retired server L1 implementation returned");
  assert.equal(pmCredentialSdkSha(row.before), row.beforeSha, file + ": complete retired source snapshot");
  return row.before;
}

export function restorePmCredentialSdkSource(file, source) {
  source = restoreMatcherLifecycleVerificationSource(file, source);
  const row = files.get(file);
  if (!row || pmCredentialSdkSha(source) !== row.afterSha) return source;
  source = normalize(source);
  for (const edit of [...row.changes].reverse()) {
    assert.equal(source.slice(edit.offset, edit.offset + edit.after.length), edit.after, file + ": exact credential SDK migration");
    source = source.slice(0, edit.offset) + edit.before + source.slice(edit.offset + edit.after.length);
  }
  assert.equal(pmCredentialSdkSha(source), row.beforeSha, file + ": complete pre-migration source must restore");
  return source;
}

export function verifyPmCredentialSdkSources(read = file => fs.readFileSync(new URL("../../" + file, import.meta.url), "utf8")) {
  for (const row of files.values()) {
    const source = restoreMatcherLifecycleVerificationSource(row.file, read(row.file), read);
    assert.equal(pmCredentialSdkSha(source), row.afterSha, row.file + ": only the exact credential SDK migration is authorized");
    assert.equal(pmCredentialSdkSha(restorePmCredentialSdkSource(row.file, source)), row.beforeSha);
  }
  for (const file of retired.keys()) readRetiredPmCredentialSdkSource(file);
  return { files: files.size, retired: retired.size };
}
