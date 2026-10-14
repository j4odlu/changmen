/** [changmen 扩展] 配套前后端只使用聚合恢复；不支持或失败由各分区退避，不降级扫描旧列表。 */
import type { GtcRecoverRequest, GtcRecoverResult } from "@changmen/shared/pm_gtc_recovery";
import type { OrderRow } from "@/types/order";
import { getAuthSessionVersion, isAuthSessionCurrent, post, unwrap } from "@/api/client";
const failure = (error: unknown) => ({ ok: false as const, message: error instanceof Error ? error.message : "GTC 恢复响应无效" });

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
  const response = await post<GtcRecoverResult<OrderRow>>("Pm_GtcRecover", { ...request }, "", { errorTip: false });
  if (!current())
    throw new Error("GTC 恢复登录状态已变更");
  const result = unwrap(response);
  return validate(result, request);
}
