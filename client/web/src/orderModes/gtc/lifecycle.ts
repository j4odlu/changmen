import { storeToRefs } from "pinia";
import { computed, watch } from "vue";
import { useUserStore } from "@/stores/userStore";
import { useOrderStore } from "@/stores/orderStore";
import { useAccountStore } from "@/stores/accountStore";

export function setupGtcLifecycle(): void {
  const user = useUserStore();
  const orders = useOrderStore();
  const accounts = useAccountStore();
  const { extensionPrefs } = storeToRefs(user);
  // [changmen 扩展] 恢复标记是加载提示；真实历史原单也能启动恢复，不依赖当前下单模式。
  const hasGtcOrders = computed(() => !accounts.adminWorkspacePreview && [...orders.orders.values()].some(rows => rows.some(row => Boolean(row.PmGtcExecutionId))));
  let gtcRuntimeOwner = "";
  watch(() => [user.isLoggedIn, user.userId, extensionPrefs.value.pmGtcV1Participant, hasGtcOrders.value, accounts.adminWorkspacePreview] as const, async ([loggedIn, owner, participant, evidence, preview]) => {
    if (!participant && !evidence && !gtcRuntimeOwner)
      return;
    const runtime = await import("@/orderModes/gtc/runtime");
    if (user.isLoggedIn !== loggedIn || user.userId !== owner)
      return;
    if (loggedIn && !preview && (user.extensionPrefs.pmGtcV1Participant || hasGtcOrders.value || gtcRuntimeOwner === String(owner))) {
      gtcRuntimeOwner = String(owner);
      runtime.startGtcRuntime(gtcRuntimeOwner);
    }
    else {
      gtcRuntimeOwner = "";
      runtime.stopGtcRuntime();
    }
  }, { immediate: true });
}
