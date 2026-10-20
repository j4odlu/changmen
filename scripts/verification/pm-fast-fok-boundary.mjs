import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
import { restoreVenueBrowserExecution } from "./venue-browser-execution.mjs";
// [changmen 扩展] 动态 FOK 单次拉簿增量；还原后核验之前的固定基线。
import assert from "node:assert/strict";
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import { createHash } from "node:crypto";
import { restorePmLegacyFokRuntimeSource, verifyPmLegacyFokRuntimeContract } from "./pm-legacy-fok-runtime-boundary.mjs";
import { restorePmWsShadowSource, verifyPmWsShadowContract } from "./pm-ws-shadow-boundary.mjs";
import { restorePmBookSettingsSource, PM_BOOK_SETTINGS_TAB } from "./pm-book-settings-boundary.mjs";
import { restorePmRejectDisplaySource } from "./pm-reject-display-boundary.mjs";
const normalize = value => value.replaceAll("\r\n", "\n");
const digest = value => createHash("sha256").update(normalize(value)).digest("hex");
const text = normalize(readAdapterHistory(new URL("./pm-fast-fok-increments.json", import.meta.url), "utf8"));
assert.equal(digest(text), "bc152fb0325876398eb67c187b21291b066e478bf2ed924b1b68dd68e9efbaab", "fast FOK reviewed increments stay fixed");
const registered = JSON.parse(text);
export function restorePmFastFokSource(file, source, required = false) {
  source = restorePmRejectDisplaySource(file, source);
  source = restorePmBookSettingsSource(file, source, required && file === PM_BOOK_SETTINGS_TAB);
  source = restorePmWsShadowSource(file, source);
  source = restorePmLegacyFokRuntimeSource(file, source);
  const row = registered.changes[file];
  if (!row) return source;
  let result = normalize(source);
  if (!required && !row.increments.some(([, after]) => result.includes(after))) return result;
  for (const [before, after] of row.increments) {
    assert.equal(result.split(after).length, 2, file + ": exact fast FOK increment");
    result = result.replace(after, before);
  }
  return result;
}
export function verifyPmFastFokContract(read) {
  const actualRead = read;
  read = file => restoreVenueBrowserExecution(file, actualRead(file));
  verifyPmWsShadowContract(read);
  verifyPmLegacyFokRuntimeContract(read);
  for (const [file, row] of Object.entries(registered.changes))
    assert.equal(digest(restorePmFastFokSource(file, read(file), true)), row.beforeSha, file + ": original source preserved");
  for (const [file, hash] of Object.entries(registered.helpers))
    assert.equal(digest(restorePmWsShadowSource(file, read(file))), hash, file + ": complete fast helper / frozen timing baseline");
}
