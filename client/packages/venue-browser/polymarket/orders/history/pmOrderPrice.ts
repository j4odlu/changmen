import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import type { VenueOrder } from "@changmen/client-core/contract";

function validPrice(value: unknown): number | undefined {
  const price = Number(value);
  return Number.isFinite(price) && price > 0 && price < 1 ? price : undefined;
}

/** [changmen 扩展] 仅使用正常同步已取得、已保存的官方限价；缺失时不补查、不推算。 */
export async function enrichPolymarketOrderPrices(
  _account: PlatformAccount,
  orders: VenueOrder[],
  storedOrders: VenueOrder[] = [],
): Promise<VenueOrder[]> {
  const storedById = new Map(storedOrders.map(order => [order.orderId.toLowerCase(), order]));
  return orders.map(order => {
    if (order.provider !== "Polymarket" || order.pmSide === "sell" || validPrice(order.pmOrderPrice))
      return order;
    const stored = storedById.get(String(order.orderId ?? "").trim().toLowerCase());
    const price = stored?.pmTokenId === order.pmTokenId ? validPrice(stored?.pmOrderPrice) : undefined;
    return price == null ? order : { ...order, pmOrderPrice: price };
  });
}
