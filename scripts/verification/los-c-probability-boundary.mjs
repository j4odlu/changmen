// [changmen 扩展] LOS 名称、设置界面及可选 C 行筛选的精确增量；保留原低赔单边证明。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = fileURLToPath(new URL("../../", import.meta.url));
const normalize = source => source.replaceAll("\r\n", "\n");
const sha = source => createHash("sha256").update(normalize(source)).digest("hex");
const text = fs.readFileSync(new URL("./los-c-probability-increments.json", import.meta.url), "utf8");
const EXPECTED_SHA = "d5809b099fd68a08f7d52132effea4e91d38d8240321c4e9cf177050d3a64ff4";
assert.equal(sha(text), EXPECTED_SHA, "LOS C probability exact increment manifest changed");
export const LOS_C_INCREMENTS = JSON.parse(text);

function canonical(file) {
  if (file instanceof URL) file = fileURLToPath(file);
  if (path.isAbsolute(file)) file = path.relative(root, file);
  return file.replaceAll("\\", "/").replace(/^packages\/client-core\//, "client/packages/client-core/");
}

export function restoreLosCProbabilitySource(file, source) {
  const row = LOS_C_INCREMENTS.changes[canonical(file)];
  if (!row || sha(source) !== row.afterSha) return source;
  const lines = normalize(source).split("\n");
  for (const edit of [...row.edits].reverse()) {
    assert.deepEqual(lines.slice(edit.start, edit.start + edit.after.length), edit.after);
    lines.splice(edit.start, edit.after.length, ...edit.before);
  }
  const restored = lines.join("\n");
  assert.equal(sha(restored), row.beforeSha, `${file}: complete source before LOS C filter must restore`);
  return restored;
}

export function verifyLosCProbabilitySources(read = file => fs.readFileSync(path.join(root, file), "utf8")) {
  for (const [file, row] of Object.entries(LOS_C_INCREMENTS.changes)) {
    const source = read(file);
    const message = file === "client/web/src/extensions/arbBet/lowOddsSingle.ts" ? "complete 🎯 helper changed" : "unregistered 🎯 change";
    assert.equal(sha(source), row.afterSha, `${file}: ${message} (LOS C filter)`);
    assert.equal(sha(restoreLosCProbabilitySource(file, source)), row.beforeSha);
  }
}
