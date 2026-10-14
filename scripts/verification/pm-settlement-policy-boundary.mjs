// [changmen 扩展] 2026-10-14 用户授权：官方 winner 优先，恢复 ≥0.99 价格提前判定。
// 精确锁定三个完整模块（已还原旧 import 路径），包含价格判定后的卖出盈亏保护。
// 不更新或豁免原 FOK/VPS 基线。
// 保留导出名称供既有迁移检查使用；指纹覆盖当前完整策略，不豁免其它变更。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const PM_OFFICIAL_SETTLEMENT_SOURCES = Object.freeze({
  "packages/venue-adapter/polymarket/orders.ts": "6d93e6eb86a51bea7b18ffbf5969457caafc693513ea86fa426ad1921cf24479",
  "packages/venue-adapter/polymarket/pmMarketGuard.ts": "f806efd56b247ca620f4a764cf4192268ccda0f7b2aae36719fa72135935722e",
  "packages/venue-adapter/polymarket/pmManualSell.ts": "e012fb657c48190229cb143a9143159d60c168c947f2c533ba9f5d94db8ffdc4",
});

export function verifyPmOfficialSettlementSource(file, source) {
  const expected = PM_OFFICIAL_SETTLEMENT_SOURCES[file];
  if (!expected)
    return false;
  const digest = createHash("sha256").update(source.replace(/\r\n/g, "\n")).digest("hex");
  assert.equal(digest, expected, `${file}: exact reviewed settlement implementation`);
  return true;
}
