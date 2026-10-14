/** [changmen 扩展] 按投注账号恢复跨日期 RAY 原单；不读取侧栏日期或下注模式。 */
import type { OrderRow } from "@/types/order";
import type { VenueOrder } from "@changmen/venue-adapter/contract";
import { post, unwrap } from "@/api/client";

export async function loadRayMonitorOrders(playerId: number, orderIds: string[]): Promise<OrderRow[]> {
  const rows = new Map<string, OrderRow>();
  for (let offset = 0; offset < Math.max(1, orderIds.length); offset += 1000) {
    const result = unwrap(await post<{ orders: OrderRow[] }>("Client_GetPlayerOrder", {
      playerId, includeLogs: false, rayMonitorOnly: true, orderIds: orderIds.slice(offset, offset + 1000),
    }, "", { errorTip: false }));
    if (!Array.isArray(result?.orders))
      throw new Error("RAY 监控订单恢复响应无效");
    for (const row of result.orders)
      rows.set(String(row.OrderID), row);
  }
  return [...rows.values()];
}

/** [changmen 扩展] 仅更新数据库已有 RAY 原单；服务端拒绝新建和终态回退。 */
export async function saveRayMonitorOrders(playerId: number, orders: VenueOrder[]): Promise<void> {
  unwrap(await post("Client_SaveOrder", {
    type: "RAY", playerId, orders: JSON.stringify(orders), rayMonitorOnly: true,
  }, "", { errorTip: false }));
}
