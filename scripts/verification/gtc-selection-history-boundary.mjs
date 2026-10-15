// [changmen 扩展] 用户要求的 GTC 选号历史前移；精确还原增量后继续比较原固定 FOK 基线。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";

const registered = fs.readFileSync(new URL("./gtc-selection-history-increments.json", import.meta.url), "utf8").replace(/\r\n/g, "\n");
assert.equal(createHash("sha256").update(registered).digest("hex"), "6d69ef135ade2e49cade5bacef826c26012f8a97aa93b2872badff2f84c83a18", "GTC history reviewed increments must remain fixed");
const changes = JSON.parse(registered);
export function restoreGtcSelectionHistorySource(file, source, replaceExact, required = false) {
  const increments = changes[file];
  if (!increments) return source;
  source = source.replace(/\r\n/g, "\n");
  const present = file.endsWith("arbLeg.ts") ? source.includes("const validateHistory =") : source.includes("gtcHistoryFilter");
  if (!present && !required) return source;
  assert(present, `${file}: GTC selection history boundary missing`);
  for (const [before, after] of increments) {
    if (source.includes(after)) {
      assert.equal(source.split(after).length, 2, `${file}: unique GTC history increment`);
      source = source.replace(after, before);
    }
    else source = replaceExact(source, after, before);
  }
  return source;
}
