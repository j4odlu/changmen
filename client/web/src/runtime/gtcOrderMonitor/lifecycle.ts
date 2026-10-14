/** [changmen 扩展] GTC 独立登录生命周期；订单模式、下注开关、侧栏和参与标记不决定恢复。 */
import { onScopeDispose, watch } from "vue";
import { useAccountStore } from "@/stores/accountStore";
import { useUserStore } from "@/stores/userStore";

export function setupGtcOrderMonitoring(): void {
  const user = useUserStore(); const accounts = useAccountStore();
  let revision = 0;
  watch(() => [user.isLoggedIn, user.userId, accounts.adminWorkspacePreview] as const, async ([loggedIn, owner, preview]) => {
    const stamp = ++revision;
    const runtime = await import("./runtime");
    if (stamp !== revision)
      return;
    if (loggedIn && owner && !preview) {
      runtime.startGtcOrderMonitoring(String(owner));
    }
    else {
      runtime.stopGtcOrderMonitoring();
    }
  }, { immediate: true });
  onScopeDispose(() => {
    revision++;
    void import("./runtime").then(runtime => runtime.stopGtcOrderMonitoring());
  });
}
