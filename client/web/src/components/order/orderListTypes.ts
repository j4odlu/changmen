import type { OrderRow } from "@/types/order";

export type OrderListEntry = readonly [number, OrderRow[]];
export interface OrderListSource {
  readonly orderEntries: ReadonlyArray<OrderListEntry>;
}
