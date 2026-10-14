import type { GtcExecution } from "@changmen/shared/pm_gtc";
import type { GtcRecoverRequest, GtcRecoverResult, GtcRecoverSection } from "@changmen/shared/pm_gtc_recovery";
import type { OrderRow } from "@/types/order";
import { needsFinancialRecovery } from "@/runtime/orderMonitoring/recoveryPolicy";
// [changmen 扩展] 监控测试的服务端分区夹具；使用当前聚合响应，不让客户端进入已删除的回退分支。
export async function mockUnifiedGtcRecovery(action: string, request: GtcRecoverRequest, readExecutions: () => Promise<GtcExecution[]>, readOrders: (ids: string[]) => Promise<OrderRow[]>) {
  if (action !== "Pm_GtcRecover") throw new Error("fixture requires the unified endpoint");
  let executions: GtcRecoverSection<GtcExecution> | null = null;
  if (request.discover) {
    try { executions = { ok: true, rows: await readExecutions() }; }
    catch (error) { executions = { ok: false, message: String(error) }; }
  }
  const skipped = new Set([...request.monitorIds, ...request.skipMonitorIds]);
  const ids = [...request.monitorIds, ...(request.recoverDiscovered && executions?.ok
    ? executions.rows.filter(row => !skipped.has(row.id) && needsFinancialRecovery(row, [])).map(row => row.id) : [])];
  const orders: GtcRecoverResult<OrderRow>["orders"] = [];
  if (ids.length) {
    try { orders.push({ ok: true, ids, unchangedIds: [], rows: await readOrders(ids) }); }
    catch (error) { orders.push({ ok: false, ids, unchangedIds: [], message: String(error) }); }
  }
  return { success: 1, info: { executions, orders } };
}
