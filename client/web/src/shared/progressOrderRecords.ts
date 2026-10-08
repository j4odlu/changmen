import type { ProgressOrderRecord } from "@changmen/shared/order_progress_evidence";
import type { OrderRow } from "@/types/order";

/** [changmen 扩展] 只复制判定所需字段；不把订单凭证或 raw 传给展示模块。 */
export function progressOrderRecords(orders: readonly OrderRow[]): ProgressOrderRecord[] {
  return orders.map(order => ({ orderId: String(order.OrderID ?? ""), provider: String(order.Type ?? ""),
    accountId: order.PlayerID, linkId: order.Link, status: String(order.Status ?? ""), shares: order.PmShares, side: order.PmSide }));
}
