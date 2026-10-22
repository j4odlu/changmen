// [changmen 扩展] 只还原已逐项登记的 🎯 增量；所有原源码、迁移和 FOK 基线继续校验。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { restorePendingOrderDisplaySource, verifyPendingOrderDisplaySources } from "./pm-pending-order-display-boundary.mjs";
import { restoreLosCProbabilitySource, verifyLosCProbabilitySources } from "./los-c-probability-boundary.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const normalize = source => source.replaceAll("\r\n", "\n");
export const lowOddsSourceSha = source => createHash("sha256").update(normalize(source)).digest("hex");
const text = fs.readFileSync(new URL("./low-odds-single-increments.json", import.meta.url), "utf8");
// The digest is fixed after recording this feature's reviewed, exact hunks.
const EXPECTED_INCREMENT_SHA = "7428d89680ac5f61505358b4a692b03f568ebb5ca3852ccfebea037af25df8da";
assert.equal(lowOddsSourceSha(text), EXPECTED_INCREMENT_SHA, "🎯 exact increment manifest changed");
export const LOW_ODDS_INCREMENTS = JSON.parse(text);

function canonical(file) {
  if (file instanceof URL) file = fileURLToPath(file);
  if (path.isAbsolute(file)) file = path.relative(root, file);
  return file.replaceAll("\\", "/")
    .replace(/^server\/db\//, "rds/")
    .replace(/^packages\/client-core\//, "client/packages/client-core/");
}

export function restoreLowOddsSingleSource(file, source) {
  source = restoreLosCProbabilitySource(file, source);
  source = restorePendingOrderDisplaySource(file, source);
  const change = LOW_ODDS_INCREMENTS.changes[canonical(file)];
  if (!change || lowOddsSourceSha(source) !== change.afterSha) return source;
  const lines = normalize(source).split("\n");
  for (const edit of [...change.edits].reverse()) {
    assert.deepEqual(lines.slice(edit.start, edit.start + edit.after.length), edit.after, `${file}: exact 🎯 hunk`);
    lines.splice(edit.start, edit.after.length, ...edit.before);
  }
  const restored = lines.join("\n");
  assert.equal(lowOddsSourceSha(restored), change.beforeSha, `${file}: entire pre-feature source must restore`);
  return restored;
}

export function verifyLowOddsSingleSources(read = file => fs.readFileSync(path.join(root, file), "utf8")) {
  verifyLosCProbabilitySources(read);
  const currentRead = read;
  read = file => restoreLosCProbabilitySource(file, currentRead(file));
  verifyPendingOrderDisplaySources(read);
  for (const [file, change] of Object.entries(LOW_ODDS_INCREMENTS.changes)) {
    const source = read(file);
    assert.equal(lowOddsSourceSha(source), change.afterSha, `${file}: unregistered 🎯 change`);
    assert.equal(lowOddsSourceSha(restoreLowOddsSingleSource(file, source)), change.beforeSha);
  }
  for (const [file, sha] of Object.entries(LOW_ODDS_INCREMENTS.helpers))
    assert.equal(lowOddsSourceSha(read(file)), sha, `${file}: complete 🎯 helper changed`);
  return { files: Object.keys(LOW_ODDS_INCREMENTS.changes).length, helpers: Object.keys(LOW_ODDS_INCREMENTS.helpers).length };
}
