/** [changmen 扩展] 恢复聚合契约；执行与财务分区失败隔离，不参与场馆交易授权。 */
import type { GtcExecution } from "./pm_gtc";

export const GTC_RECOVERY_KNOWN_LIMIT = 10000;
export interface GtcRecoverRequest {
  discover: boolean;
  knownRevisions: Record<string, number>;
  monitorIds: string[];
  recoverDiscovered: boolean;
  skipMonitorIds: string[];
  knownOrders: Record<string, string>;
}
export type GtcRecoverSection<T> = { ok: true; rows: T[] } | { ok: false; message: string };
export type GtcRecoverOrders<T> = GtcRecoverSection<T> & { ids: string[]; unchangedIds: string[] };
export interface GtcRecoverResult<T> {
  executions: GtcRecoverSection<GtcExecution> | null;
  orders: GtcRecoverOrders<T>[];
}
interface FinancialRow {
  PmGtcExecutionId?: string;
  PlayerID?: number;
  Type?: string;
  OrderID?: string | number;
  PmSide?: string;
  Status?: string;
  BetMoney?: number;
  Money?: number;
  PmShares?: number;
  PmStakeUsdc?: number;
  PmFeeUsdc?: number;
}
export function gtcRecoveryFinancialKey(rows: FinancialRow[]): string {
  return JSON.stringify(rows.map(row => [row.PmGtcExecutionId, row.PlayerID, row.Type, String(row.OrderID).toLowerCase(), row.PmSide, String(row.Status).toLowerCase(), row.BetMoney, row.Money, row.PmShares, row.PmStakeUsdc, row.PmFeeUsdc])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
}
