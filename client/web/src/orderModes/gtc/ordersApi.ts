import type { PmSubmission } from "@changmen/shared/pm_submission";
import type { VenueOrder } from "@changmen/venue-adapter/contract";
import type { PlatformAccount } from "@/models/platformAccount";
import type { OrderRow } from "@/types/order";
import { getAuthSessionVersion, isAuthSessionCurrent, post, unwrap } from "@/api/client";
import { tagKnownGtcVenueOrders } from "./executionProjection";
import { reconcileGtcSellFinancials } from "./sellFinancials";
import { readLegacyGtcMonitorOrders, validateMonitorIds } from "./legacyMonitorOrders";

/** [changmen 扩展] 监控恢复按原单身份取数，不受侧栏日期限制，不建立第二份财务列表。 */
export async function loadGtcMonitorOrders(ids: string[], isCurrent: () => boolean = () => true): Promise<OrderRow[]> {
  validateMonitorIds(ids);
  const session = getAuthSessionVersion();
  const checkCurrent = () => {
    if (!isAuthSessionCurrent(session) || !isCurrent())
      throw new Error("GTC 监控恢复登录状态已变更");
  };
  const read = async <T>(action: string, body: Record<string, unknown>) => {
    checkCurrent();
    const response = await post<T>(action, body, "", { errorTip: false });
    checkCurrent();
    return response;
  };
  const rows: OrderRow[] = [];
  for (let offset = 0; offset < ids.length; offset += 1000) {
    const batch = ids.slice(offset, offset + 1000);
    const response = await read<OrderRow[]>("Pm_GtcMonitorOrders", { ids: batch });
    if (response.success === 0 && response.msg === "未知预测市场 action: Pm_GtcMonitorOrders" && !response.code) {
      rows.push(...await readLegacyGtcMonitorOrders(batch, async (action, body) =>
        unwrap(await read(action, body))));
    }
    else {
      const orders = unwrap(response);
      if (!Array.isArray(orders))
        throw new Error("GTC 监控恢复订单响应无效");
      rows.push(...orders);
    }
  }
  checkCurrent();
  return rows;
}

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

export async function refreshGtcOrders(date?: string, isCurrent: () => boolean = () => true): Promise<void> {
  const session = getAuthSessionVersion();
  const { useOrderStore } = await import("@/stores/orderStore");
  if (!isAuthSessionCurrent(session) || !isCurrent())
    return;
  const store = useOrderStore();
  await store.fetchOrders(date ?? store.orderDate);
}
