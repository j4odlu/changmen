/** [changmen 扩展] 对侧监控只更新用户端现有原单，持久化仍由正常订单同步负责。 */
import type { VenueOrder } from "@changmen/venue-adapter/contract";
import type { OrderRow } from "@/types/order";
import { useOrderStore } from "@/stores/orderStore";
export function updateGtcCounterpartLocally(playerId: number, original: VenueOrder): void {
  const store = useOrderStore();
  let changed = false;
  for (const rows of store.orders.values()) for (const row of rows) {
    if (row.PlayerID !== playerId || row.Type !== original.provider || String(row.OrderID) !== original.orderId
      || ["win", "lose", "lost", "reject", "return"].includes(String(row.Status).toLowerCase())) continue;
    const status = (original.status[0]!.toUpperCase() + original.status.slice(1)) as OrderRow["Status"];
    if (row.Status !== status) { row.Status = status; changed = true; }
    for (const [field, value] of [["Money", original.money], ["BetMoney", original.betMoney], ["Odds", original.odds]] as const) {
      if (typeof value === "number" && Number.isFinite(value) && row[field] !== value) { row[field] = value; changed = true; }
    }
  }
  if (changed) store.updateTodayProfit([...store.orders.values()].flat());
}
