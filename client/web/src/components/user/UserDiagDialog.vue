<script setup lang="ts">
import type { Component } from "vue";
import { storeToRefs } from "pinia";
/**
 * 用户中心弹窗：`border-card` tabs；宽度由标签栏自适应，内容在框内换行。
 */
import { computed, onMounted, ref, watch } from "vue";
import UserDiagChatTab from "@/components/user/tabs/UserDiagChatTab.vue";
import UserDiagCollectTab from "@/components/user/tabs/UserDiagCollectTab.vue";
import UserDiagExtensionsTab from "@/components/user/tabs/UserDiagExtensionsTab.vue";
import UserDiagFollowTab from "@/components/user/tabs/UserDiagFollowTab.vue";
import UserDiagMessageTab from "@/components/user/tabs/UserDiagMessageTab.vue";
import UserDiagPasswordTab from "@/components/user/tabs/UserDiagPasswordTab.vue";
import UserDiagProxyTab from "@/components/user/tabs/UserDiagProxyTab.vue";
import UserDiagRankTab from "@/components/user/tabs/UserDiagRankTab.vue";
import UserDiagReportTab from "@/components/user/tabs/UserDiagReportTab.vue";
import UserDiagTradeTab from "@/components/user/tabs/UserDiagTradeTab.vue";
import UserDiagUiTab from "@/components/user/tabs/UserDiagUiTab.vue";
import UserDiagWalletTab from "@/components/user/tabs/UserDiagWalletTab.vue";
import { parseFormBool } from "@/shared/parseFormBool";
import { useUserStore } from "@/stores/userStore";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();
const user = useUserStore();
const { setting } = storeToRefs(user);
const active = ref("rank");
const extrasReady = ref(false);

const visible = computed({
  get: () => props.open,
  set: (v: boolean) => {
    if (!v)
      emit("close");
  },
});

interface TabDef {
  name: string;
  label: string;
  component: Component;
  show?: () => boolean;
}

const tabDefs: TabDef[] = [
  { name: "rank", label: "排行榜", component: UserDiagRankTab },
  { name: "pass", label: "修改密码", component: UserDiagPasswordTab },
  { name: "message", label: "消息通知", component: UserDiagMessageTab },
  { name: "proxy", label: "代理配置", component: UserDiagProxyTab },
  { name: "report", label: "报表查询", component: UserDiagReportTab },
  { name: "collect", label: "赛事采集", component: UserDiagCollectTab },
  {
    name: "trade",
    label: "操盘",
    component: UserDiagTradeTab,
    show: () => parseFormBool(setting.value?.BetTarget) || user.betTargetEnabled(),
  },
  {
    name: "follow",
    label: "跟单",
    component: UserDiagFollowTab,
    show: () => user.followEnabled,
  },
  { name: "chat", label: "聊天室", component: UserDiagChatTab },
  { name: "wallet", label: "钱包", component: UserDiagWalletTab },
  { name: "ui", label: "界面", component: UserDiagUiTab },
  { name: "extensions", label: "扩展", component: UserDiagExtensionsTab },
];

const visibleTabs = computed(() => tabDefs.filter(t => !t.show || t.show()));

watch(
  () => props.open,
  () => {
    if (!visibleTabs.value.some(t => t.name === active.value)) {
      active.value = "rank";
    }
  },
  { immediate: true },
);

onMounted(() => {
  if (!visibleTabs.value.some(t => t.name === active.value)) {
    active.value = "rank";
  }
});

async function onDialogOpen() {
  extrasReady.value = false;
  try {
    await user.loadExtras(true);
  }
  finally {
    extrasReady.value = true;
  }
}

function onDialogClosed() {
  extrasReady.value = false;
  emit("close");
}
</script>

<template>
  <el-dialog
    v-model="visible"
    class="user-diag-dialog"
    width="fit-content"
    :show-close="false"
    append-to-body
    destroy-on-close
    @open="onDialogOpen"
    @closed="onDialogClosed"
  >
    <div v-loading="!extrasReady">
      <el-tabs v-model="active" type="border-card">
        <el-tab-pane v-for="tab in visibleTabs" :key="tab.name" :label="tab.label" :name="tab.name">
          <component :is="tab.component" v-if="extrasReady && active === tab.name" />
        </el-tab-pane>
      </el-tabs>
    </div>
  </el-dialog>
</template>
