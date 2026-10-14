/** [changmen 扩展] GTC 后台财务副本恢复独立于 PM 原单事实核对，只查询仍需要财务证据的原单。 */
import type { GtcExecution } from "@changmen/shared/pm_gtc";
import type { OrderRow } from "@/types/order";
import { gtcUnits } from "@changmen/shared/pm_gtc";
import { gtcRecoveryFinancialKey } from "@changmen/shared/pm_gtc_recovery";
import { findGtcFinalOrder, gtcPmReconciled } from "@/orderModes/gtc/pollingPolicy";

export function needsFinancialRecovery(row: GtcExecution, orders: OrderRow[]): boolean {
  const pm = row.orderId ? row : { ...row, orderId: row.plan.orderHash };
  const zeroFillEnded = gtcPmReconciled(row) && gtcUnits(row.matched) === 0n;
  const pmMayExist = row.pmAuthorized || row.orderId || !["prepared", "not_attempted"].includes(row.submit)
    || Number(row.financialOrder?.pmShares) > 0;
  return Boolean(pmMayExist && pm.orderId && !zeroFillEnded && !findGtcFinalOrder(pm, orders, true))
    || Boolean(row.other.orderId && !findGtcFinalOrder(row, orders, false)
      && ["authorized", "accepted", "pending", "unknown", "filled"].includes(row.other.state));
}

// 后台版本号、observedAt 和费用补记不会改变原单财务查询范围。
export function financialRecoveryKey(row: GtcExecution): string {
  return JSON.stringify([row.plan.playerId, row.orderId || row.plan.orderHash, row.pmAuthorized, row.submit, row.matched, row.terminal, row.complete, row.plan.otherPlayerId, row.plan.otherProvider, row.other.orderId, row.other.state]);
}

export function financialResultKey(rows: OrderRow[]): string {
  return gtcRecoveryFinancialKey(rows);
}

export const unchangedDelay = (count: number) => Math.min(300000, 60000 * 2 ** Math.min(count, 3));
export const recoveryRetryDelay = (failures: number) => Math.min(300000, 5000 * 2 ** Math.min(failures - 1, 6));
