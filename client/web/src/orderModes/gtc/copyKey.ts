import type { GtcExecution } from "@changmen/shared/pm_gtc";

/** [changmen 扩展] 副本按业务内容去重；查询时间与后台版本不构成新的订单事实。 */
export function gtcCopyKey(row: GtcExecution): string {
  const order = row.order;
  return JSON.stringify([
    row.pmAuthorized,
    row.submitNotSent ?? false,
    row.submit,
    row.orderId,
    row.decision,
    row.deadlineAt,
    row.other.state,
    row.other.notSent ?? false,
    row.other.orderId,
    row.other.submittedAt,
    row.other.message,
    row.manual,
    row.released,
    row.counted,
    row.matched,
    row.principal,
    row.fee,
    row.open,
    row.terminal,
    row.complete,
    row.groupComplete,
    row.error,
    row.cancel ? [row.cancel.commandId, row.cancel.state, row.cancel.message] : null,
    order
      ? [order.id, order.original, order.matched, order.status, [...order.tradeIds].sort(), order.source ?? null]
      : null,
    Object.values(row.fills).sort((a, b) => a.key.localeCompare(b.key)).map(fill => [
      fill.key,
      fill.tradeId,
      fill.bucket,
      fill.role,
      fill.shares,
      fill.price,
      fill.fee,
      fill.status,
      fill.updatedAt,
    ]),
  ]);
}
