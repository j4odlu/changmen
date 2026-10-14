import type { GtcExecution } from "@changmen/shared/pm_gtc";
import type { OrderRow } from "@/types/order";
import { gtcPmNeverSubmitted } from "@changmen/shared/pm_gtc";
import { orderExecutionIdentity } from "@/orderModes/gtc/executionIdentity";
import { isFootballOrderRow } from "@/shared/orderDomain";
import { resolveOrderItemLabel } from "@/shared/orderItemDisplay";
import { compareOrderLinkDesc, dropOrphanPolymarketSellGroups, filterOrdersBelongingToDate, groupOrdersByEffectiveLink, orderLinkMapEntries } from "@/shared/orderLink";
import { gtcMatchedOrder } from "./financialOrder";
import { gtcOrderCardView } from "./orderCardView";
import { lookupPolymarketOrderBetLabel } from "@changmen/venue-adapter/polymarket/orders";

function originalItemText(execution: GtcExecution): string {
  const entities: Record<string, string> = { apos: "'", quot: "\"", amp: "&", lt: "<", gt: ">", nbsp: " " };
  // Match 在普通列表中按 HTML 展示，Item 是纯文本，先解码以避免实体字面量泄漏。
  return resolveOrderItemLabel(execution.plan.item, execution.plan.match)
    .replace(/&(?:#(\d+)|#x([\da-f]+)|(apos|quot|amp|lt|gt|nbsp));/gi, (entity, decimal: string | undefined, hex: string | undefined, named: string | undefined) => {
      if (named)
        return entities[named.toLowerCase()]!;
      const point = decimal ? Number(decimal) : Number.parseInt(hex!, 16);
      return point > 0 && point <= 0x10FFFF && !(point >= 0xD800 && point <= 0xDFFF) ? String.fromCodePoint(point) : entity;
    });
}

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
    DisplayOnly: true,
    PmGtcExecutionId: execution.id,
    PmTokenId: plan.tokenId,
    PmConditionId: plan.conditionId,
    PmOrigin: "changmen",
    Link: plan.linkId,
    Type: "Polymarket",
    PlayerID: plan.playerId,
    Match: plan.match,
    Bet: lookupPolymarketOrderBetLabel(plan.conditionId, plan.tokenId) || "盘口待核实",
    Item: originalItemText(execution),
    CreateAt: execution.createdAt,
    Status: execution.submit === "rejected" && !view.unsubmitted
      ? "Reject"
      : execution.submit === "accepted" && execution.terminal && execution.complete && !execution.error && view.quantitiesAgree && matched === 0 ? "Return" : "None",
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
    const pmLabel = row.Type === "Polymarket" ? lookupPolymarketOrderBetLabel(row.PmConditionId, row.PmTokenId) : "";
    group.rows.push({ ...row, ...(pmLabel ? { Bet: pmLabel } : {}),
      ...(row.Type === "Polymarket" && row.PmSide !== "sell" && Number(row.PmFillPrice) > 0 ? { Odds: undefined } : {}),
    });
    byExecution.set(identity.executionId, group);
  }
  for (const execution of executions) {
    // [changmen 扩展] 临时原单也只住 Link 归属日；未释放执行不能绕过日期筛选。
    const belongsToDate = filterOrdersBelongingToDate([{ CreateAt: execution.createdAt, Link: execution.plan.linkId }], date).length > 0;
    // [changmen 扩展] 副本缺失时可展示完整、相互一致的官方成交事实；不从旧累计量复活已释放历史。
    const releasedFactsCanDisplay = execution.submit === "accepted" && (Number(execution.matched) === 0
      || (execution.complete && !execution.error && gtcOrderCardView(execution).quantitiesAgree));
    // [changmen 扩展] 未提交的是执行记录；即使对腿已受理，也不能生成 PM 订单占位行。
    const showMissingOriginal = belongsToDate && !gtcPmNeverSubmitted(execution)
      && (!execution.released || releasedFactsCanDisplay);
    let group = byExecution.get(execution.id);
    if (!group) {
      if (!showMissingOriginal)
        continue;
      group = { rows: [] };
      byExecution.set(execution.id, group);
    }
    group.execution = execution;
    const hasOriginal = group.rows.some(row => row.Type === "Polymarket" && row.PmSide !== "sell"
      && row.PlayerID === execution.plan.playerId
      && String(row.OrderID).toLowerCase() === String(execution.orderId ?? execution.plan.orderHash).toLowerCase());
    if (!hasOriginal && showMissingOriginal) {
      group.pending = pendingOrderRow(execution);
      group.rows.push(group.pending);
    }
  }
  return [...byExecution].map(([id, group]) => ({
    id,
    ...group,
    // 临时原单与财务行均使用普通日期归属，不影响独立监控恢复。
    entries: orderLinkMapEntries(dropOrphanPolymarketSellGroups(groupOrdersByEffectiveLink([
      ...filterOrdersBelongingToDate(group.rows.filter(row => row !== group.pending), date),
      ...(group.pending ? [group.pending] : []),
    ]))),
  })).filter(group => group.entries.length);
}

export function isGtcOriginalBuy(row: OrderRow, execution: GtcExecution): boolean {
  return row.Type === "Polymarket" && row.PmSide !== "sell" && row.PlayerID === execution.plan.playerId
    && [execution.orderId, execution.plan.orderHash, `gtc-pending:${execution.id}`].filter(Boolean).some(id => String(row.OrderID).trim().toLowerCase() === String(id).trim().toLowerCase());
}

/** [changmen 扩展] 仅提供尚无财务行的展示原单；账号筛选及精确身份去重不改财务数据。 */
export function gtcPendingDisplayRows(financialRows: OrderRow[], executions: GtcExecution[], date: string, accountId: number): OrderRow[] {
  return gtcOrderDisplayGroups(financialRows, executions, date, accountId)
    .flatMap(group => group.pending && (!accountId || group.pending.PlayerID === accountId)
      && !financialRows.some(row => isGtcOriginalBuy(row, group.execution!)
        && (!row.PmGtcExecutionId || row.PmGtcExecutionId === group.id))
      ? [group.pending]
      : []);
}

/** [changmen 扩展] 精确原单恢复监控标识，再合入同 Link 展示行；FOK 原组保持原对象。 */
export function mergeGtcPendingDisplayEntries(entries: readonly (readonly [number, OrderRow[]])[], pendingRows: OrderRow[], executions: GtcExecution[] = []) {
  if (!pendingRows.length && !executions.length)
    return entries;
  const groups = new Map(entries);
  let changed = false;
  for (const [link, rows] of groups) {
    let tagged = false;
    const next = rows.map((row) => {
      if (row.PmGtcExecutionId || row.Type !== "Polymarket" || row.PmSide === "sell")
        return row;
      const originals = executions.filter(execution => isGtcOriginalBuy(row, execution));
      // 身份冲突保持原行，不按 Link 猜测来源，也不覆盖财务字段。
      if (originals.length !== 1)
        return row;
      tagged = true;
      return { ...row, PmGtcExecutionId: originals[0]!.id };
    });
    if (tagged) {
      groups.set(link, next);
      changed = true;
    }
  }
  for (const pending of pendingRows) {
    if ([...groups.values()].some(rows => rows.some(row => row.Type === "Polymarket" && row.PmSide !== "sell"
      && row.PlayerID === pending.PlayerID && String(row.OrderID).trim().toLowerCase() === String(pending.OrderID).trim().toLowerCase()))) {
      continue;
    }
    const link = Number(pending.Link);
    groups.set(link, [...(groups.get(link) ?? []), pending]);
    changed = true;
  }
  return changed ? orderLinkMapEntries(groups).sort(([a], [b]) => compareOrderLinkDesc({ Link: a }, { Link: b })) : entries;
}
