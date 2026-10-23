// [changmen 扩展] 精确登记 PM 单订单 Pending 生命周期；旧发送与确认策略仍按原基线校验。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { restoreFrontendDependencySource } from "./frontend-dependency-refactor.mjs";
import { restorePmSubmittedOddsDisplaySource } from "./pm-submitted-odds-display.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const normalize = source => source.replaceAll("\r\n", "\n");
export const pendingOrderDisplaySha = source => createHash("sha256").update(normalize(source)).digest("hex");
const manifest = fs.readFileSync(new URL("./pm-pending-order-display-increments.json", import.meta.url), "utf8");
const EXPECTED_INCREMENT_SHA = "3994648e9adee7573930076c157142fa951ddda7b7ed9eaabe1451ae063926b4";
assert.equal(pendingOrderDisplaySha(manifest), EXPECTED_INCREMENT_SHA, "PM original-order display manifest changed");
export const PENDING_ORDER_DISPLAY_INCREMENTS = JSON.parse(manifest);

function canonical(file) {
  if (file instanceof URL) file = fileURLToPath(file);
  if (path.isAbsolute(file)) file = path.relative(root, file);
  return file.replaceAll("\\", "/")
    .replace(/^server\/db\//, "rds/")
    .replace(/^packages\/client-core\//, "client/packages/client-core/");
}

export function restorePendingOrderDisplaySource(file, source) {
  source = restorePmSubmittedOddsDisplaySource(canonical(file), source);
  source = restoreFrontendDependencySource(canonical(file), source);
  const row = PENDING_ORDER_DISPLAY_INCREMENTS.changes[canonical(file)];
  if (!row || pendingOrderDisplaySha(source) !== row.afterSha) return source;
  const lines = normalize(source).split("\n");
  for (const edit of [...row.edits].reverse()) {
    assert.deepEqual(lines.slice(edit.start, edit.start + edit.after.length), edit.after, `${file}: exact original-order display hunk`);
    lines.splice(edit.start, edit.after.length, ...edit.before);
  }
  const restored = lines.join("\n");
  assert.equal(pendingOrderDisplaySha(restored), row.beforeSha, `${file}: complete original source must restore`);
  return restored;
}

export function verifyPendingOrderDisplaySources(read = file => fs.readFileSync(path.join(root, file), "utf8")) {
  for (const [file, row] of Object.entries(PENDING_ORDER_DISPLAY_INCREMENTS.changes)) {
    const source = restoreFrontendDependencySource(file, restorePmSubmittedOddsDisplaySource(file, read(file)));
    assert.equal(pendingOrderDisplaySha(source), row.afterSha, `${file}: unregistered original-order display change`);
    assert.equal(pendingOrderDisplaySha(restorePendingOrderDisplaySource(file, source)), row.beforeSha);
  }
  for (const [file, sha] of Object.entries(PENDING_ORDER_DISPLAY_INCREMENTS.helpers))
    assert.equal(pendingOrderDisplaySha(restoreFrontendDependencySource(file, read(file))), sha, `${file}: complete original-order display helper changed`);
  return { files: Object.keys(PENDING_ORDER_DISPLAY_INCREMENTS.changes).length };
}
