import type { PmSubmission } from "@changmen/shared/pm_submission";
import type { VenueOrder } from "@changmen/venue-adapter/contract";
import type { PlatformAccount } from "@/models/platformAccount";
import { post, unwrap } from "@/api/client";
import { tagKnownGtcVenueOrders } from "./executionProjection";
import { reconcileGtcSellFinancials } from "./sellFinancials";

export async function getPmSubmission(playerId: number, orderId: string): Promise<PmSubmission | null> {
  const response = await post<PmSubmission>("Pm_GetSubmission", { playerId, orderId }, "", { errorTip: false });
  return response.success === 1 ? response.info ?? null : null;
}

export async function saveOrders(account: PlatformAccount, orders: VenueOrder[]): Promise<void> {
  if (account.provider === "PredictFun")
    return;
  const tagged = await reconcileGtcSellFinancials(account, tagKnownGtcVenueOrders(account.accountId, orders));
  const groups = new Map<string, VenueOrder[]>();
  for (const order of tagged) {
    const type = String(order.provider ?? account.provider);
    if (type === "PredictFun")
      continue;
    const list = groups.get(type) ?? [];
    list.push(order);
    groups.set(type, list);
  }
  for (const [type, list] of groups)
    unwrap(await post("Pm_GtcSaveOrders", { type, playerId: account.accountId, orders: JSON.stringify(list) }));
}

export async function refreshGtcOrders(date?: string): Promise<void> {
  const { useOrderStore } = await import("@/stores/orderStore");
  const store = useOrderStore();
  await store.fetchOrders(date ?? store.orderDate);
}
