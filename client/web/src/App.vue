<script setup lang="ts">
import { ElConfigProvider } from "element-plus";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import { storeToRefs } from "pinia";
import { effectScope, onScopeDispose, watch, watchEffect } from "vue";
import { useRoute } from "vue-router";
import PmVaultDialogs from "@/components/account/PmVaultDialogs.vue";
import { setupGtcOrderMonitoring } from "@/runtime/gtcOrderMonitor/lifecycle";
import { setupRayOrderMonitoring } from "@/runtime/rayOrderMonitor/lifecycle";
import { setupSingleLegStrategy } from "@/runtime/singleLegStrategy";
import { setupGtcOrderSynchronization } from "@/stores/account/gtcOrderSync";
import { applyUiTheme } from "@/shared/applyUiTheme";
import { useUserStore } from "@/stores/userStore";

const user = useUserStore();
const { extensionPrefs } = storeToRefs(user);
const route = useRoute();
// [changmen 扩展] 管理页面只读服务端数据，不启动用户端的场馆查单和执行恢复。
let userRuntime: ReturnType<typeof effectScope> | undefined;
watch(() => route.matched.length > 0 && !route.meta.requiresAdmin, (enabled) => {
  userRuntime?.stop();
  userRuntime = undefined;
  if (!enabled)
    return;
  userRuntime = effectScope();
  userRuntime.run(() => {
    setupGtcOrderMonitoring();
    setupRayOrderMonitoring();
    setupGtcOrderSynchronization();
    setupSingleLegStrategy();
  });
}, { immediate: true, flush: "sync" });
onScopeDispose(() => userRuntime?.stop());

watchEffect(() => {
  applyUiTheme(extensionPrefs.value.uiTheme);
});
</script>

<template>
  <ElConfigProvider :locale="zhCn">
    <router-view />
    <PmVaultDialogs />
  </ElConfigProvider>
</template>
