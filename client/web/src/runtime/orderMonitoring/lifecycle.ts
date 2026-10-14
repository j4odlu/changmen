/** [changmen 扩展] 登录后恢复场馆监控，订单模式、侧栏和参与标记不决定恢复。 */
import { onScopeDispose, watch } from "vue";
import { useAccountStore } from "@/stores/accountStore";
import { useUserStore } from "@/stores/userStore";

export function setupOrderMonitoring(): void {
  const user = useUserStore(); const accounts = useAccountStore();
  let revision = 0;
  watch(() => [user.isLoggedIn, user.userId, accounts.adminWorkspacePreview] as const, async ([loggedIn, owner, preview]) => {
    const stamp = ++revision;
    const runtime = await import("./session");
    if (stamp !== revision)
      return;
    if (loggedIn && owner && !preview) {
      runtime.startOrderMonitoring(String(owner));
    }
    else {
      runtime.stopOrderMonitoring();
    }
  }, { immediate: true });
  onScopeDispose(() => {
    revision++;
    void import("./session").then(runtime => runtime.stopOrderMonitoring());
  });
}
