<script setup lang="ts">
import { computed, defineAsyncComponent, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import LoginPanel from "@/components/auth/LoginPanel.vue";
import SessionRestoreLoader from "@/components/layout/SessionRestoreLoader.vue";
import PluginIntroShell from "@/components/layout/PluginIntroShell.vue";
import { useCertGate } from "@/composables/useCertGate";
import { useExtensionGate } from "@/composables/useExtensionGate";
import { useUserStore } from "@/stores/userStore";

const HomeView = defineAsyncComponent(() => import("@/views/HomeView.vue"));
const SportsWorkspace = defineAsyncComponent(() => import("@/views/SportsWorkspace.vue"));

const route = useRoute();
const router = useRouter();
const user = useUserStore();
const { extensionReady, extensionChecked } = useExtensionGate();
const { certReady, certChecked } = useCertGate();
const sessionReady = computed(() => user.ready);
const sessionChecked = computed(() => user.sessionChecked);
/** Wave A：`/sports/*` 走体育页；`/` 仍为原 HomeView（内容不动） */
const isSportsRoute = computed(() => route.path.startsWith("/sports"));
/** B：客户端证书 + Chrome 插件 都具备才出登录框 */
const accessReady = computed(() => extensionReady.value && certReady.value);
/** 两道门都完成首次探测后再判定 Coming soon / 登录，避免误闪 */
const gatesChecked = computed(() => certChecked.value && extensionChecked.value);
const restoreSlow = ref(false);
let restoreTimer: ReturnType<typeof setTimeout> | undefined;
const restoring = computed(() => !sessionReady.value && !sessionChecked.value);
watch(restoring, (pending) => {
  if (restoreTimer)
    clearTimeout(restoreTimer);
  restoreSlow.value = false;
  if (pending)
    restoreTimer = setTimeout(() => { restoreSlow.value = true; }, 12_000);
}, { immediate: true });
onUnmounted(() => {
  if (restoreTimer)
    clearTimeout(restoreTimer);
});
// 恢复不可用时保留旧凭证，由用户主动提交新登录；不自动重放登录请求。
const showLoginGate = computed(
  () => gatesChecked.value && accessReady.value
    && (sessionChecked.value || restoreSlow.value || Boolean(user.sessionRestoreError)),
);
/** 会话已判定且（无证或无插件）：Coming soon */
const showComingSoon = computed(
  () => sessionChecked.value && gatesChecked.value && !accessReady.value,
);
/** 首次 Cookie 探测失败时也显示恢复错误与重试入口，避免无本地凭证时只剩背景。 */
const showSessionRestore = computed(
  () => !sessionReady.value && !showLoginGate.value
    && (!sessionChecked.value || Boolean(user.sessionRestoreError)),
);

async function onLoginSuccess() {
  const redirect = sessionStorage.getItem("gamebet:postLoginRedirect");
  sessionStorage.removeItem("gamebet:postLoginRedirect");
  if (redirect && redirect !== "/" && redirect.startsWith("/")) {
    await router.replace(redirect);
  }
}
</script>

<template>
  <template v-if="sessionReady">
    <SportsWorkspace v-if="isSportsRoute" />
    <KeepAlive v-else>
      <HomeView />
    </KeepAlive>
  </template>
  <SessionRestoreLoader
    v-else-if="showSessionRestore"
    :error="user.sessionRestoreError"
    @retry="user.restoreSession()"
  />
  <PluginIntroShell v-else-if="showLoginGate" :show-login="true">
    <p v-if="user.sessionRestoreError || restoreSlow" class="login-error" role="status">
      {{ user.sessionRestoreError || "登录恢复耗时较长，可以重新登录" }}
    </p>
    <LoginPanel @success="onLoginSuccess" />
  </PluginIntroShell>
  <PluginIntroShell v-else-if="showComingSoon" :show-coming-soon="true" />
  <PluginIntroShell v-else />
</template>
