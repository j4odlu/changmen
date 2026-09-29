import type { VenueOrder } from "@changmen/venue-adapter/contract";
import type { PlatformAccount } from "@/models/platformAccount";
import type { OrderRow, PageResult } from "@/types/esport";
import { post, unwrap } from "@/api/client";
import type { PmSubmission } from "@changmen/shared/pm_submission";

/** [changmen 扩展] 旧待确认队列按原单恢复申请额，不能从当前赔率推算。 */
export async function getPmSubmission(playerId: number, orderId: string): Promise<PmSubmission | null> {
  const response = await post<PmSubmission>("Pm_GetSubmission", { playerId, orderId }, "", { errorTip: false });
  return response.success === 1 ? response.info ?? null : null;
}

/** [A8 可证实] `Ut.getOrders`：success!==1 时不更新侧栏（返回 null） */
export async function getOrderList(body: Record<string, unknown> = {}) {
  const data = await post<PageResult<OrderRow>>("Client_GetOrderList", body);
  if (data.success !== 1)
    return null;
  return data.info ?? { list: [], total: 0, pageIndex: 1, pageSize: 20 };
}

export async function saveOrder(body: Record<string, unknown>) {
  return unwrap(await post<unknown>("Client_SaveOrder", body));
}

/**
 * 对齐 bundle `Vt.saveOrders`：按 provider 分组调用 `Client_SaveOrder`。
 * [changmen 扩展] PredictFun 禁止客户端回写：订单只经 Pf_* 服务端落库。
 */
export async function saveOrders(account: PlatformAccount, orders: VenueOrder[]): Promise<void> {
  if (String(account.provider ?? "").trim() === "PredictFun")
    return;
  const byProvider = new Map<string, VenueOrder[]>();
  for (const order of orders) {
    const provider = String(order.provider ?? "").trim();
    if (provider === "PredictFun")
      continue;
    const list = byProvider.get(provider) ?? [];
    list.push(order);
    byProvider.set(provider, list);
  }
  for (const [type, list] of byProvider) {
    await saveOrder({
      type,
      playerId: account.accountId,
      orders: JSON.stringify(list),
    });
  }
}

/**
 * [A8 可证实] `Vt.saveOrderBind`：空数组不 POST。
 * [changmen 扩展] 返回是否成功（业务失败不抛，供绑单重试/UI 感知）。
 */
export async function saveOrderBind(body: Record<string, unknown>): Promise<boolean> {
  const raw = body.orders;
  if (typeof raw === "string") {
    try {
      const rows = JSON.parse(raw) as unknown[];
      if (!rows?.length)
        return true;
    }
    catch {
      // 非 JSON 时仍交给服务端
    }
  }
  const data = await post<boolean>("Client_SaveOrderBind", body, "", { errorTip: false });
  return data.success === 1;
}

/** [changmen 扩展] 侧栏手动改绑：单笔订单 link 新→老 */
export async function rebindOrderLink(body: {
  orderId: string;
  toLinkId: number;
}): Promise<{ orderId: string; fromLinkId: number; toLinkId: number }> {
  return unwrap(
    await post<{ orderId: string; fromLinkId: number; toLinkId: number }>(
      "Client_RebindOrderLink",
      body,
    ),
  );
}
