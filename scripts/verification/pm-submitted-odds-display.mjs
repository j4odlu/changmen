// [changmen 扩展] 只还原 FOK 买单缺失提交赔率的展示修正，保留原始展示基线。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { restorePmOrderOddsPairSource } from "./pm-order-odds-pair.mjs";

export const PM_SUBMITTED_ODDS_DISPLAY_FILE = "client/web/src/shared/pmOrderDisplay.ts";
const normalize = source => source.replaceAll("\r\n", "\n");
const sha = source => createHash("sha256").update(normalize(source)).digest("hex");
const BEFORE_SHA = "6de2c3dc77656c0ca0792f2668e2b39b4c4c85b611d506fba4509f04fb726bf3";
const AFTER_SHA = "1b7e39610568c72b60714f68ed19c71a5ac384b3110b9ec37d7621cb286a4cde";
const before = `/** 赔率：优先订单 Odds（盘口/撮合）；否则 1/买入价 */
export function pmOrderOddsText(row: OrderRow): string {
  const storedOdds = Number(row.Odds);
  if (Number.isFinite(storedOdds) && storedOdds > 1)
    return toFixed(truncateOddsTo3(storedOdds), 3);
  const price = resolvePmFillPrice(row);
  const odds = price != null
    ? truncateOddsTo3(1 / price)
    : truncateOddsTo3(0);
  return toFixed(odds, 3);
}`;
const after = `/** 普通 PM 买单只展示保存的提交赔率；GTC 和卖单保留成交价赔率口径。 */
export function pmOrderOddsText(row: OrderRow): string {
  const storedOdds = Number(row.Odds);
  if (Number.isFinite(storedOdds) && storedOdds > 1)
    return toFixed(truncateOddsTo3(storedOdds), 3);
  // 缺失提交赔率不能用实际买入价反算，否则会混淆提交与成交。
  if (isPmBuyOrderListRow(row) && !row.PmGtcExecutionId)
    return "—";
  const price = resolvePmFillPrice(row);
  return price != null ? toFixed(truncateOddsTo3(1 / price), 3) : "—";
}`;

export function restorePmSubmittedOddsDisplaySource(file, source) {
  source = restorePmOrderOddsPairSource(file, source);
  if (file !== PM_SUBMITTED_ODDS_DISPLAY_FILE || sha(source) !== AFTER_SHA)
    return source;
  const text = normalize(source);
  assert.equal(text.split(after).length, 2, `${file}: exact submitted odds display correction`);
  const restored = text.replace(after, before);
  assert.equal(sha(restored), BEFORE_SHA, `${file}: entire source before submitted odds correction must restore`);
  return restored;
}
