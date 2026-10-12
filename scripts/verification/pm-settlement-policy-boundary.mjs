// [changmen 扩展] 2026-10-12 用户授权：持仓赛果只认官方 winner，移除价格贴端结算。
// 精确锁定这两个完整模块（已还原旧 import 路径），不更新或豁免原 FOK/VPS 基线。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const PM_OFFICIAL_SETTLEMENT_SOURCES = Object.freeze({
  "packages/venue-adapter/polymarket/orders.ts": "02ea2ac9e2d770e301e0bb40e7caeb094ac5061aefe4e9fc32724e12afdc6685",
  "packages/venue-adapter/polymarket/pmMarketGuard.ts": "6b1ef820b49682fbfedb71b872408e1f25738f38a1c19609bc393e8e022eaf75",
});

export function verifyPmOfficialSettlementSource(file, source) {
  const expected = PM_OFFICIAL_SETTLEMENT_SOURCES[file];
  if (!expected)
    return false;
  const digest = createHash("sha256").update(source.replace(/\r\n/g, "\n")).digest("hex");
  assert.equal(digest, expected, `${file}: exact reviewed official-only settlement implementation`);
  return true;
}
