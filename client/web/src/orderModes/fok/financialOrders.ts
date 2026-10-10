import type { OrderRow } from "@/types/order";
import { useOrderStore as useOrdinaryOrderStore } from "@/stores/orderStore";

/** [changmen 扩展] FOK automation consumes its own originals from the common order list. */
export function useOrderStore(): ReturnType<typeof useOrdinaryOrderStore> {
  const store = useOrdinaryOrderStore();
  return new Proxy(store, {
    get(target, property, receiver) {
      if (property !== "orders")
        return Reflect.get(target, property, receiver);
      if (![...target.orders.values()].some(rows => rows.some(row => row.PmGtcExecutionId)))
        return target.orders;
      const out = new Map<number, OrderRow[]>();
      for (const [link, rows] of target.orders) {
        const own = rows.filter(row => !row.PmGtcExecutionId);
        if (own.length)
          out.set(link, own);
      }
      return out;
    },
  });
}
