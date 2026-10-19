/** [changmen 扩展] 场馆监控仅更新现有客户端订单，不创建账本订单或发起 HTTP 请求。 */
import type { VenueOrder } from "@changmen/venue-browser/adapter/contract";
import type { OrderRow } from "@/types/order";
import { useOrderStore } from "@/stores/orderStore";

export function rayClientStatus(status: VenueOrder["status"]): OrderRow["Status"] {
  return (status[0]!.toUpperCase() + status.slice(1)) as OrderRow["Status"];
}

export function updateRayOrdersLocally(player: number, orders: readonly VenueOrder[]): void {
  const store = useOrderStore();
  const byId = new Map(orders.filter(order => order.provider === "RAY").map(order => [String(order.orderId), order]));
  let changed = false;
  for (const rows of store.orders.values()) {
    for (const row of rows) {
      if (row.Type !== "RAY" || row.PlayerID !== player || row.DisplayOnly)
        continue;
      const order = byId.get(String(row.OrderID));
      if (!order || ["win", "lose", "lost", "return", "reject"].includes(String(row.Status).toLowerCase()))
        continue;
      const status = rayClientStatus(order.status);
      if (row.Status !== status) { row.Status = status; changed = true; }
      // 身份、Link、买入时间和 GTC/POD 元数据沿用已有行，仅更新场馆事实。
      for (const [field, value] of [["Odds", order.odds], ["BetMoney", order.betMoney], ["Money", order.money]] as const) {
        if (typeof value === "number" && Number.isFinite(value) && row[field] !== value) {
          row[field] = value; changed = true;
        }
      }
    }
  }
  if (changed)
    store.updateTodayProfit([...store.orders.values()].flat());
}
