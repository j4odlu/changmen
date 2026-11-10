import type { OrderRow } from "@/types/order";
import { useNow } from "@vueuse/core";
import { lookupRayNativeOrderDisplay } from "@changmen/venue-browser/adapter/ray/bet";
import { rayMonitoring } from "@/runtime/orderMonitoring/rayState";
import { resolveRayOrderDisplayStatus } from "@/shared/rayOrderDisplay";
import { useAccountStore } from "@/stores/accountStore";
import { useUserStore } from "@/stores/userStore";

/** 只刷新原站时间窗口的显示，不发请求、不写订单或监控状态。 */
export function useRayOrderDisplay() {
  const now = useNow({ interval: 1000 });
  const accounts = useAccountStore(), user = useUserStore();
  return (row: OrderRow): string | undefined => {
    if (row.Type !== "RAY") return undefined;
    const current = user.isLoggedIn && !accounts.adminWorkspacePreview;
    const account = current ? accounts.findAccount(row.PlayerID) : undefined;
    const native = account?.provider === "RAY" && row.OrderID != null
      ? lookupRayNativeOrderDisplay(account, String(row.OrderID), now.value.getTime()) : undefined;
    const monitoring = current && rayMonitoring.owner === String(user.userId)
      ? rayMonitoring.orders.get(`${row.PlayerID}:${row.OrderID}`) : undefined;
    return resolveRayOrderDisplayStatus(row, native, monitoring);
  };
}
