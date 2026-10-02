import type { BetResult } from "@changmen/client-core/models/betResult";
import type { VenueOrder } from "@changmen/venue-adapter/contract";
import type { PlatformAccount } from "@/models/platformAccount";
import { wait } from "@changmen/client-core/shared/wait";
import { saveOrderBind } from "@/api/esport";
import { observeOrder } from "@/services/orderObservation";

const BIND_RETRY_TIMES = 3;
const BIND_RETRY_GAP_MS = 400;

/** [A8 可证实] 列表非空时绑 orders[0].orderId */
function resolveA8VenueBindOrderId(orders: VenueOrder[]): string | undefined {
  if (orders.length === 0)
    return undefined;
  const id = String(orders[0].orderId ?? "").trim();
  return id || undefined;
}

/** 绑单 orderId：拒单腿优先绑本次检测到的拒单；成单腿优先 result.orderId，否则 orders[0] */
export function resolveArbBindOrderId(
  orders: VenueOrder[],
  result: BetResult | undefined,
  rejected = false,
): string | undefined {
  const fromResult = String(result?.orderId ?? "").trim();
  if (rejected) {
    if (fromResult) {
      const ours = orders.find(o => String(o.orderId ?? "") === fromResult);
      if (ours)
        return fromResult;
    }
    return resolveA8VenueBindOrderId(orders);
  }
  if (fromResult)
    return fromResult;
  return resolveA8VenueBindOrderId(orders);
}

/**
 * 套利/补单：把场馆订单绑到同一 LinkID。
 * [changmen 扩展] 失败重试；不抛错，返回是否成功。
 */
export async function bindArbLegOrder(
  linkId: number,
  account: PlatformAccount,
  result: BetResult,
  orders: VenueOrder[],
  rejected: boolean,
): Promise<boolean> {
  if (!linkId || !result?.success)
    return false;
  const orderId = resolveArbBindOrderId(orders, result, rejected);
  if (!orderId)
    return false;

  const bound = await bindArbOrderId(linkId, result.provider, account.accountId, orderId);
  observeOrder(result.observation, linkId, "bind_result", { provider: result.provider, accountId: account.accountId, orderId, outcome: bound ? "saved" : "failed", source: "bind_api_ack" });
  return bound;
}

/** 已知场馆 orderId 的 Link 绑定；供延迟发现订单的旁路监控复用。 */
export async function bindArbOrderId(
  linkId: number,
  provider: string,
  accountId: number,
  orderId: string,
): Promise<boolean> {
  if (!linkId || !accountId || !String(orderId).trim())
    return false;

  const payload = {
    orders: JSON.stringify([
      {
        LinkID: linkId,
        Provider: provider,
        PlayerID: accountId,
        OrderID: orderId,
      },
    ]),
  };

  for (let attempt = 1; attempt <= BIND_RETRY_TIMES; attempt++) {
    try {
      const ok = await saveOrderBind(payload);
      if (ok)
        return true;
      console.warn(
        `[arbOrderBind] SaveOrderBind failed attempt ${attempt}/${BIND_RETRY_TIMES}`,
        { linkId, provider, orderId },
      );
    }
    catch (e) {
      console.warn(
        `[arbOrderBind] SaveOrderBind error attempt ${attempt}/${BIND_RETRY_TIMES}`,
        e,
      );
    }
    if (attempt < BIND_RETRY_TIMES)
      await wait(BIND_RETRY_GAP_MS);
  }
  return false;
}

/** 绑单后刷新侧栏订单列表（合并组可见） */
export function refreshOrderListAfterBind(): void {
  void import("@/stores/orderStore")
    .then(({ useOrderStore }) => useOrderStore().fetchOrders())
    .catch(() => {});
}
