// [changmen 扩展] Exact offline inverse for the PF marketId fallback repair.
// Runtime reads the repaired source; historical migration baselines stay immutable.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const fileName = "client/packages/venue-browser/adapter/predictfun/bet.ts";
const beforeSha = "10b5b3a1fc1c6fd4f9ccf71d63fce2bc4ad950a493ea65ad8cb4138048966e5b";
const afterSha = "2c2e49a432eadcfbaa9627e172cfc2981c6cdaa796f775f3c3cec02ad9cf7851";
const normalize = source => source.replaceAll("\r\n", "\n");
const sha = source => createHash("sha256").update(normalize(source)).digest("hex");
const before = '  return String(fromData?.marketId ?? fromItem ?? cached ?? fromIndex ?? "").trim();';
const after = `  // 空串和纯空白也表示缺失，不能阻断后续缓存与 MarketIndex 回退。
  return [fromData?.marketId, fromItem, cached, fromIndex]
    .map(value => String(value ?? "").trim())
    .find(value => value.length > 0) ?? "";`;

export function restorePfMarketIdSource(file, source) {
  if (file !== fileName || sha(source) !== afterSha) return source;
  source = normalize(source);
  assert.equal(source.split(after).length, 2, "Exact PF marketId repair must occur once");
  const restored = source.replace(after, before);
  assert.equal(sha(restored), beforeSha, "Complete original PF implementation must restore");
  return restored;
}

export function verifyPfMarketIdSource(read) {
  assert.equal(sha(read(fileName)), afterSha, "Only the exact PF marketId fallback repair is authorized");
  return { files: 1 };
}
