/** [changmen 扩展] 普通订单同步保存成功后，持久化 RAY 用户端已确认的原单关联。 */
import type { VenueOrder } from "@changmen/venue-adapter/contract";
import type { PlatformAccount } from "@/models/platformAccount";
import { getActivePinia } from "pinia";
import { getAuthSessionVersion, isAuthSessionCurrent } from "@/api/client";
import { useRayOrderContextStore } from "@/runtime/rayOrderMonitor/contextStore";
import { bindArbOrderId } from "@/stores/betting/arbOrderBind";
import { useAccountStore } from "@/stores/accountStore";
import { useOrderStore } from "@/stores/orderStore";
import { useUserStore } from "@/stores/userStore";

export async function syncRayOrderBindings(account: PlatformAccount, orders: readonly VenueOrder[]): Promise<void> {
  if (!getActivePinia())
    return;
  const user = useUserStore();
  const accountStore = useAccountStore();
  const owner = String(user.userId || "");
  if (!owner || user.isLoggedIn === false || accountStore.adminWorkspacePreview)
    return;
  const contexts = useRayOrderContextStore();
  contexts.restore(owner);
  const session = getAuthSessionVersion();
  const binding = JSON.stringify([account.gateway, account.token, account.currency]);
  const current = () => isAuthSessionCurrent(session) && String(user.userId || "") === owner
    && user.isLoggedIn !== false && !accountStore.adminWorkspacePreview
    && accountStore.findAccount(account.accountId) === account
    && binding === JSON.stringify([account.gateway, account.token, account.currency]);
  const ids = new Set(orders.filter(order => order.provider === "RAY").map(order => String(order.orderId)));
  for (const task of [...contexts.tasks.values()]) {
    if (!current())
      return;
    if (task.accountId !== account.accountId || !task.boundOrderId || !task.monitorBound || task.bindingSaved || !ids.has(task.boundOrderId))
      continue;
    const known = [...useOrderStore().orders.values()].flat().find(row => row.Type === "RAY"
      && row.PlayerID === account.accountId && String(row.OrderID) === task.boundOrderId);
    if (known?.Link && known.Link !== task.linkId && known.Link !== known.CreateAt && known.Link !== Number(known.CreateAt) - 1) {
      contexts.patch(task.key, { lastError: "场馆原单已属于其他 Link，未自动改绑" });
      continue;
    }
    contexts.patch(task.key, { orderSaved: true });
    try {
      if (known?.Link !== task.linkId && !await bindArbOrderId(task.linkId, "RAY", account.accountId, task.boundOrderId))
        throw new Error("RAY 原单关联保存失败，等待订单同步重试");
      if (current())
        contexts.patch(task.key, { bindingSaved: true, lastError: undefined });
    }
    catch (error) {
      if (current())
        contexts.patch(task.key, { lastError: error instanceof Error ? error.message : String(error) });
    }
  }
}
