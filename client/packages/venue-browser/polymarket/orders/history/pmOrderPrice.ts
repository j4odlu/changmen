import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import type { VenueOrder } from "@changmen/client-core/contract";
import { pmGetOrder } from "../pmClientApi";

function validPrice(value: unknown): number | undefined {
  const price = Number(value);
  return Number.isFinite(price) && price > 0 && price < 1 ? price : undefined;
}

/** [changmen 扩展] 同步官方订单限价；已随订单保存的 price 直接复用，不从签单或成交价反推。 */
export async function enrichPolymarketOrderPrices(
  account: PlatformAccount,
  orders: VenueOrder[],
  storedOrders: VenueOrder[] = [],
): Promise<VenueOrder[]> {
  const storedById = new Map(storedOrders.map(order => [order.orderId.toLowerCase(), order]));
  const reads = new Map<string, Promise<number | undefined>>();
  const result = [...orders];
  let next = 0;
  async function worker() {
    while (next < orders.length) {
      const index = next++;
      const order = orders[index]!;
      if (order.provider !== "Polymarket" || order.pmSide === "sell" || validPrice(order.pmOrderPrice))
        continue;
      const id = String(order.orderId ?? "").trim();
      const stored = storedById.get(id.toLowerCase());
      const savedPrice = stored?.pmTokenId === order.pmTokenId ? validPrice(stored?.pmOrderPrice) : undefined;
      if (savedPrice != null) {
        result[index] = { ...order, pmOrderPrice: savedPrice };
        continue;
      }
      // 本地拒单占位 id 没有对应的官方订单。
      if (!/^0x[0-9a-f]{64}$/i.test(id))
        continue;
      let read = reads.get(id.toLowerCase());
      if (!read) {
        read = pmGetOrder<{ id?: string; price?: string | number; asset_id?: string; side?: string }>(account, id)
          .then(row => {
            if (String(row?.id ?? "").toLowerCase() !== id.toLowerCase()
              || String(row.side ?? "").toUpperCase() !== "BUY"
              || (order.pmTokenId && row.asset_id !== order.pmTokenId))
              return undefined;
            return validPrice(row.price);
          })
          .catch(() => undefined);
        reads.set(id.toLowerCase(), read);
      }
      const price = await read;
      if (price != null)
        result[index] = { ...order, pmOrderPrice: price };
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, orders.length) }, () => worker()));
  return result;
}
