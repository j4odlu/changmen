/** [changmen 扩展] RAY 自有登录生命周期，不依赖 GTC 监控容器或下注循环。 */
import { onScopeDispose, watch } from "vue";
import { useAccountStore } from "@/stores/accountStore";
import { useUserStore } from "@/stores/userStore";
import { startRayOrderMonitoring, stopRayOrderMonitoring } from "./runtime";

export function setupRayOrderMonitoring(): void {
  const user = useUserStore(); const accounts = useAccountStore();
  watch(() => [user.isLoggedIn, user.userId, accounts.adminWorkspacePreview] as const, ([loggedIn, owner, preview]) => {
    stopRayOrderMonitoring();
    if (loggedIn && owner && !preview)
      startRayOrderMonitoring();
  }, { immediate: true });
  onScopeDispose(stopRayOrderMonitoring);
}
