import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import type { VenueOrder } from "../../../contract";

export type PolymarketStoredVenueOrdersLoader = (
  account: PlatformAccount,
) => Promise<VenueOrder[]>;

let storedOrdersLoader: PolymarketStoredVenueOrdersLoader | null = null;

/** Web 层注册：从 RDS 加载 changmen 已存 PM 订单（对齐 A8 saveOrders 后再 getOrders 合并） */
export function registerPolymarketStoredVenueOrdersLoader(
  fn: PolymarketStoredVenueOrdersLoader,
): void {
  storedOrdersLoader = fn;
}

export async function loadPolymarketStoredVenueOrders(
  account: PlatformAccount,
): Promise<VenueOrder[]> {
  if (!storedOrdersLoader)
    return [];
  try {
    return await storedOrdersLoader(account);
  }
  catch (err) {
    console.warn("[Polymarket] loadPolymarketStoredVenueOrders failed", err);
    return [];
  }
}
