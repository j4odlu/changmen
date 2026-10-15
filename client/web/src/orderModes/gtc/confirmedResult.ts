/** [changmen 扩展] 只投影 CONFIRMED 成交和明确 FAILED 修正，沿用原份额、费用与金额算法。 */
import type { GtcExecution } from "@changmen/shared/pm_gtc";
import type { GtcConfirmedResult } from "@changmen/shared/pm_gtc_result";
import { mergeGtcFacts } from "@changmen/shared/pm_gtc";
import { gtcFinancialOrder } from "./financialOrder";

export function confirmedGtcResult(row: GtcExecution): GtcConfirmedResult | null {
  if (!row.orderId)
    return null;
  const fills = Object.values(row.fills).filter(fill => fill.status === "FAILED"
    || (fill.status === "CONFIRMED" && fill.fee != null));
  if (!fills.length)
    return null;
  const totals = mergeGtcFacts({ ...row, fills: {}, order: null }, { order: null, fills, complete: true, observedAt: row.observedAt });
  const financial = gtcFinancialOrder({ ...totals, complete: true });
  if (!financial)
    return null;
  return { executionId: row.id, orderId: row.orderId, playerId: row.plan.playerId, linkId: row.plan.linkId,
    createdAt: row.createdAt, revision: row.revision, match: row.plan.match, bet: row.plan.bet, item: row.plan.item,
    tokenId: row.plan.tokenId, conditionId: row.plan.conditionId, buyShares: totals.matched,
    principalUsdc: totals.principal, feeUsdc: totals.fee!, fills, financial };
}
export function gtcResultKey(result: GtcConfirmedResult): string {
  const { revision: _revision, ...facts } = result;
  return JSON.stringify({ ...facts, fills: [...facts.fills].sort((a, b) => a.key.localeCompare(b.key))
    .map(({ updatedAt: _updatedAt, ...fill }) => fill) });
}
