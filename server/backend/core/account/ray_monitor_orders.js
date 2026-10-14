/** [changmen 扩展] 独立 RAY 监控恢复：跨日期未结原单及客户端仍在观察的精确单号。 */
import { fetchOrdersByPlayerStrict } from "@changmen/db";
import { toClientOrder } from "./order/dto.js";

export async function listRayMonitorOrders(playerId, userId, orderIds = []) {
  if (!Array.isArray(orderIds) || orderIds.length > 1000 || orderIds.some(id => typeof id !== "string" || !id.trim()))
    throw new Error("RAY 监控原单号列表无效");
  const rows = await fetchOrdersByPlayerStrict(playerId, userId, { rayMonitorOrderIds: orderIds });
  return rows.map(toClientOrder);
}
