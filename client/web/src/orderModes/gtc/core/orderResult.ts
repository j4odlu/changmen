import type { GtcConfirmedResult } from "@changmen/shared/pm_gtc_result";
import { mergeGtcOrderFacts } from "@changmen/shared/pm_gtc_order";
import type { GtcOrderRecord } from "./orderRecord";
import { gtcFinancialOrder } from "../financialOrder";

/** [changmen 扩展] 一张原单的已确认成交更新公共 orders；不按业务类型重新计算金额或费用。 */
export function confirmedOrderResult(row: GtcOrderRecord): GtcConfirmedResult | null {
  if (!row.orderId) return null;
  const fills = Object.values(row.fills).filter(fill => fill.status === "FAILED" || (fill.status === "CONFIRMED" && fill.fee != null));
  if (!fills.length) return null;
  const totals = mergeGtcOrderFacts({ ...row, fills: {}, order: null }, { order: null, fills, complete: true, observedAt: row.observedAt });
  const financial = gtcFinancialOrder({ ...totals, complete: true });
  if (!financial) return null;
  return { executionId: row.id, orderId: row.orderId, playerId: row.accountId, linkId: row.context.linkId,
    createdAt: row.createdAt, revision: row.revision, match: row.context.match, bet: row.context.bet, item: row.context.item,
    tokenId: row.plan.tokenId, conditionId: row.plan.conditionId, buyShares: totals.matched,
    principalUsdc: totals.principal, feeUsdc: totals.fee!, fills, financial };
}
export function orderResultKey(result: GtcConfirmedResult): string {
  const { revision: _revision, ...facts } = result;
  return JSON.stringify({ ...facts, fills: [...facts.fills].sort((a, b) => a.key.localeCompare(b.key))
    .map(({ updatedAt: _updatedAt, ...fill }) => fill) });
}
