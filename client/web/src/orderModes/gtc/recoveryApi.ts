import type { GtcExecution } from "@changmen/shared/pm_gtc";
/** [changmen 扩展] 正常恢复只调用聚合接口；旧后台明确不支持时才使用兼容读取。 */
import type { GtcRecoverRequest, GtcRecoverResult, GtcRecoverSection } from "@changmen/shared/pm_gtc_recovery";
import type { OrderRow } from "@/types/order";
import { getAuthSessionVersion, isAuthSessionCurrent, post, unwrap } from "@/api/client";
import { needsFinancialRecovery } from "@/runtime/orderMonitoring/recoveryPolicy";
import { listGtc } from "./api";
import { loadGtcMonitorOrders } from "./ordersApi";

let legacySession: string | number | undefined;
const failure = (error: unknown) => ({ ok: false as const, message: error instanceof Error ? error.message : "GTC 恢复响应无效" });

async function legacy(request: GtcRecoverRequest, isCurrent: () => boolean): Promise<GtcRecoverResult<OrderRow>> {
  const executionsTask: Promise<GtcRecoverSection<GtcExecution> | null> = request.discover
    ? listGtc(undefined, Object.fromEntries(Object.entries(request.knownRevisions).slice(0, 1000)))
        .then(rows => ({ ok: true as const, rows }))
        .catch(failure)
    : Promise.resolve(null);
  const ordersTask = request.monitorIds.length
    ? loadGtcMonitorOrders(request.monitorIds, isCurrent).then(rows => ({ ok: true as const, ids: request.monitorIds, unchangedIds: [], rows })).catch(error => ({ ...failure(error), ids: request.monitorIds, unchangedIds: [] }))
    : Promise.resolve(null);
  const [executions, requestedOrders] = await Promise.all([executionsTask, ordersTask]);
  const orders = requestedOrders ? [requestedOrders] : [];
  if (isCurrent() && request.recoverDiscovered && executions?.ok) {
    const skipped = new Set([...request.monitorIds, ...request.skipMonitorIds]);
    const ids = executions.rows.filter(row => !skipped.has(row.id) && needsFinancialRecovery(row, [])).map(row => row.id);
    for (let offset = 0; offset < ids.length; offset += 1000) {
      const batch = ids.slice(offset, offset + 1000);
      try { orders.push({ ok: true, ids: batch, unchangedIds: [], rows: await loadGtcMonitorOrders(batch, isCurrent) }); }
      catch (error) { orders.push({ ...failure(error), ids: batch, unchangedIds: [] }); }
    }
  }
  return { executions, orders };
}

function validate(result: GtcRecoverResult<OrderRow>, request: GtcRecoverRequest): GtcRecoverResult<OrderRow> {
  let executions = request.discover ? result?.executions : null;
  if (request.discover && (!executions || typeof executions.ok !== "boolean" || (executions.ok
    ? !Array.isArray(executions.rows)
    || executions.rows.some(row => !row || typeof row.id !== "string" || typeof row.owner !== "string")
    : typeof executions.message !== "string"))) {
    executions = failure(new Error("GTC 执行恢复响应无效"));
  }
  const allowed = new Set([...request.monitorIds, ...(executions?.ok ? executions.rows.map(row => row.id) : [])]);
  const parts = Array.isArray(result?.orders) ? result.orders : [];
  const orders: GtcRecoverResult<OrderRow>["orders"] = [];
  let malformed = !Array.isArray(result?.orders);
  const seen = new Set<string>();
  for (const part of parts) {
    if (!part || !Array.isArray(part.ids) || part.ids.length > 1000 || new Set(part.ids).size !== part.ids.length || part.ids.some(id => !allowed.has(id) || seen.has(id))
      || typeof part.ok !== "boolean" || !Array.isArray(part.unchangedIds)
      || part.unchangedIds.some(id => !part.ids.includes(id) || request.knownOrders[id] == null)
      || (part.ok ? !Array.isArray(part.rows) || part.rows.some(row => !row || !part.ids.includes(row.PmGtcExecutionId!)) : typeof part.message !== "string")) {
      malformed = true;
      continue;
    }
    orders.push(part);
    part.ids.forEach(id => seen.add(id));
  }
  const skipped = new Set(request.skipMonitorIds);
  const expected = new Set([...request.monitorIds, ...(malformed && request.recoverDiscovered && executions?.ok
    ? executions.rows.filter(row => !skipped.has(row.id)).map(row => row.id)
    : [])]);
  const missing = [...expected].filter(id => !seen.has(id));
  for (let offset = 0; offset < missing.length; offset += 1000)
    orders.push({ ...failure(new Error(malformed ? "GTC 财务恢复响应无效" : "GTC 财务恢复响应缺失")), ids: missing.slice(offset, offset + 1000), unchangedIds: [] });
  return { executions: executions ?? null, orders };
}

export async function recoverGtc(request: GtcRecoverRequest, isCurrent: () => boolean): Promise<GtcRecoverResult<OrderRow>> {
  const session = getAuthSessionVersion();
  const current = () => isAuthSessionCurrent(session) && isCurrent();
  if (!current())
    throw new Error("GTC 恢复登录状态已变更");
  let result: GtcRecoverResult<OrderRow>;
  if (legacySession === session) {
    result = await legacy(request, current);
  }
  else {
    const response = await post<GtcRecoverResult<OrderRow>>("Pm_GtcRecover", { ...request }, "", { errorTip: false });
    if (!current())
      throw new Error("GTC 恢复登录状态已变更");
    if (response.success === 0 && response.msg === "未知预测市场 action: Pm_GtcRecover" && !response.code) {
      legacySession = session;
      result = await legacy(request, current);
    }
    else {
      result = unwrap(response);
    }
  }
  if (!current())
    throw new Error("GTC 恢复登录状态已变更");
  return validate(result, request);
}

export function resetGtcRecoveryApi(): void { legacySession = undefined; }
