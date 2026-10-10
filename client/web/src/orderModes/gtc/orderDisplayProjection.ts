import type { GtcExecution } from "@changmen/shared/pm_gtc";
import type { OrderRow } from "@/types/order";
import { gtcCanFinishWithoutOrders } from "@changmen/shared/pm_gtc";
import { orderExecutionIdentity } from "@/orderModes/gtc/executionIdentity";
import { isFootballOrderRow } from "@/shared/orderDomain";
import { dropOrphanPolymarketSellGroups, filterOrdersBelongingToDate, groupOrdersByEffectiveLink, orderLinkMapEntries } from "@/shared/orderLink";
import { gtcMatchedOrder } from "./financialOrder";
import { gtcOrderCardView } from "./orderCardView";

/** [changmen 扩展] 未落财务库的原单仅适配为展示行，不写 OrderStore/统计/数据库。 */
function pendingOrderRow(execution: GtcExecution): OrderRow {
  const { plan } = execution;
  const view = gtcOrderCardView(execution);
  const matched = Number(execution.matched);
  const display = view.quantitiesAgree && matched > 0
    ? gtcMatchedOrder(execution, view.fee == null ? 0 : Number(view.fee))
    : null;
  return {
    OrderID: execution.orderId ?? `gtc-pending:${execution.id}`,
    PmGtcExecutionId: execution.id,
    Link: plan.linkId,
    Type: "Polymarket",
    PlayerID: plan.playerId,
    Match: plan.match,
    Bet: plan.bet,
    Item: plan.item,
    CreateAt: execution.createdAt,
    Status: execution.submit === "rejected" && !view.unsubmitted ? "Reject" : "None",
    PmSide: "buy",
    // 普通 PM 成交显示助手负责金额、成交价和赔率；无明细不使用计划量/限价。
    ...(view.quantitiesAgree ? { PmShares: matched } : {}),
    ...(display
      ? {
          PmFillPrice: display.pmFillPrice,
          Odds: display.odds,
          // 未知手续费不能按零费用展示成本；成交价/赔率仍来自普通助手。
          ...(view.fee != null
            ? {
                PmStakeUsdc: display.pmStakeUsdc,
                PmFeeUsdc: display.pmFeeUsdc ?? 0,
                BetMoney: display.betMoney,
              }
            : {}),
        }
      : view.quantitiesAgree && matched === 0 ? { PmStakeUsdc: 0, PmFeeUsdc: 0, BetMoney: 0 } : {}),
  };
}

export function gtcOrderDisplayGroups(financialRows: OrderRow[], executions: GtcExecution[], date: string, accountId: number) {
  const byExecution = new Map<string, { rows: OrderRow[]; execution?: GtcExecution; pending?: OrderRow }>();
  for (const row of filterOrdersBelongingToDate(financialRows, date)) {
    if (isFootballOrderRow(row) || (accountId && row.PlayerID !== accountId))
      continue;
    const identity = orderExecutionIdentity(row);
    if (identity.executionKind !== "pm-gtc-v1" || !identity.executionId)
      continue;
    const group = byExecution.get(identity.executionId) ?? { rows: [] };
    // 旧 GTC 入库赔率曾误用含费成本；展示沿用普通 PM 的成交价赔率回退。
    group.rows.push(row.Type === "Polymarket" && row.PmSide !== "sell" && Number(row.PmFillPrice) > 0
      ? { ...row, Odds: undefined }
      : row);
    byExecution.set(identity.executionId, group);
  }
  for (const execution of executions) {
    let group = byExecution.get(execution.id);
    if (!group) {
      if (execution.released || gtcCanFinishWithoutOrders(execution))
        continue;
      group = { rows: [] };
      byExecution.set(execution.id, group);
    }
    group.execution = execution;
    const hasOriginal = group.rows.some(row => row.Type === "Polymarket" && row.PmSide !== "sell"
      && row.PlayerID === execution.plan.playerId
      && String(row.OrderID).toLowerCase() === String(execution.orderId ?? execution.plan.orderHash).toLowerCase());
    if (!hasOriginal && !execution.released && !gtcCanFinishWithoutOrders(execution)) {
      group.pending = pendingOrderRow(execution);
      group.rows.push(group.pending);
    }
  }
  return [...byExecution].map(([id, group]) => ({
    id,
    ...group,
    // 保留活跃原单原有的持续可见性；财务行继续使用普通日期分组。
    entries: orderLinkMapEntries(dropOrphanPolymarketSellGroups(groupOrdersByEffectiveLink([
      ...filterOrdersBelongingToDate(group.rows.filter(row => row !== group.pending), date),
      ...(group.pending ? [group.pending] : []),
    ]))),
  })).filter(group => group.entries.length);
}

export function isGtcOriginalBuy(row: OrderRow, execution: GtcExecution): boolean {
  return row.Type === "Polymarket" && row.PmSide !== "sell" && row.PlayerID === execution.plan.playerId
    && [execution.orderId ?? execution.plan.orderHash, `gtc-pending:${execution.id}`]
      .some(id => String(row.OrderID).toLowerCase() === String(id).toLowerCase());
}
