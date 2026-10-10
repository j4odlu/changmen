<script setup lang="ts">
import { ElConfigProvider } from "element-plus";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import { storeToRefs } from "pinia";
import { watchEffect } from "vue";
import PmVaultDialogs from "@/components/account/PmVaultDialogs.vue";
import { setupGtcLifecycle } from "@/orderModes/gtc/lifecycle";
import { applyUiTheme } from "@/shared/applyUiTheme";
import { useUserStore } from "@/stores/userStore";

const user = useUserStore();
const { extensionPrefs } = storeToRefs(user);
setupGtcLifecycle();

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
