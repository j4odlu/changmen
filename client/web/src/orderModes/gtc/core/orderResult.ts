import type { GtcConfirmedResult } from "@changmen/shared/pm_gtc_result";
import { gtcAcceptedOrder, gtcOrderResultStatus } from "@changmen/shared/pm_gtc_result";
import { mergeGtcOrderFacts } from "@changmen/shared/pm_gtc_order";
import type { GtcOrderRecord } from "./orderRecord";
import { gtcFinancialOrder } from "../financialOrder";

/** [changmen 扩展] 一张原单的已确认成交更新公共 orders；不按业务类型重新计算金额或费用。 */
export function confirmedOrderResult(row: GtcOrderRecord): GtcConfirmedResult | null {
  if (!row.orderId) return null;
  const fills = Object.values(row.fills).filter(fill => fill.status === "FAILED" || (fill.status === "CONFIRMED" && fill.fee != null));
  const acceptedOrder = gtcAcceptedOrder(row);
  if (!fills.length && !acceptedOrder) return null;
  const totals = mergeGtcOrderFacts({ ...row, fills: {}, order: null }, { order: null, fills, complete: true, observedAt: row.observedAt });
  const financial = fills.length ? gtcFinancialOrder({ ...totals, complete: true })
    : { pmShares: 0, pmFillPrice: 0, pmStakeUsdc: 0, pmFeeUsdc: 0, odds: 0, betMoney: 0 };
  if (!financial) return null;
  // 已终止原单的后续核对可能发现迟到成交；显式 None 可清除先前的零成交 Return。
  const status = gtcOrderResultStatus(row);
  return { ...(status === "Return" || row.terminal ? { status } : {}), ...(acceptedOrder ? { acceptedOrder } : {}), executionId: row.id, orderId: row.orderId, playerId: row.accountId, linkId: row.context.linkId,
    createdAt: row.createdAt, revision: row.revision, match: row.context.match, bet: row.context.bet, item: row.context.item,
    ...(row.context.clientMarket ? { clientMarket: row.context.clientMarket } : {}),
    tokenId: row.plan.tokenId, conditionId: row.plan.conditionId, buyShares: totals.matched,
    principalUsdc: totals.principal, feeUsdc: totals.fee!, fills, financial };
}
export function orderResultKey(result: GtcConfirmedResult): string {
  const { revision: _revision, ...facts } = result;
  return JSON.stringify({ ...facts, fills: [...facts.fills].sort((a, b) => a.key.localeCompare(b.key))
    .map(({ updatedAt: _updatedAt, ...fill }) => fill) });
}
