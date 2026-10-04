<script setup lang="ts">
import { ElMessage } from "element-plus";
import { storeToRefs } from "pinia";
import { computed, onMounted, onUnmounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import AccountBar from "@/components/account/AccountBar.vue";
import AccountEditDialog from "@/components/account/AccountEditDialog.vue";
import FootballSettingsDialog from "@/components/football/FootballSettingsDialog.vue";
import PodFollowPanel from "@/components/football/PodFollowPanel.vue";
import AppSidebar from "@/components/layout/AppSidebar.vue";
import DirectRealtimeBadge from "@/components/layout/DirectRealtimeBadge.vue";
import BaseballBoard from "@/components/match/BaseballBoard.vue";
import BasketballBoard from "@/components/match/BasketballBoard.vue";
import FootballBoard from "@/components/match/FootballBoard.vue";
import TennisBoard from "@/components/match/TennisBoard.vue";
import { useExtensionGate } from "@/composables/useExtensionGate";
import { closeFootballSettings, openFootballSettings } from "@/runtime/footballSettingsUi";
import { mountSportsSession, stopSportsSession } from "@/runtime/sportsSession";
import { useAccountStore } from "@/stores/accountStore";
import { useUserStore } from "@/stores/userStore";

const SPORTS = ["football", "basketball", "baseball", "tennis"] as const;
type SportCode = (typeof SPORTS)[number];

const route = useRoute();
const router = useRouter();
const user = useUserStore();
const accountStore = useAccountStore();
const { editDialogOpen, editDialogAccount } = storeToRefs(accountStore);
const { extensionReady, extensionChecked, refreshExtension } = useExtensionGate();

const sport = computed<SportCode>(() => {
  const raw = String(route.params.sport || "").toLowerCase();
  if ((SPORTS as readonly string[]).includes(raw))
    return raw as SportCode;
  return "football";
});

onMounted(() => {
  void mountSportsSession();
  const raw = String(route.params.sport || "").toLowerCase();
  if (!(SPORTS as readonly string[]).includes(raw))
    void router.replace({ name: "sports-board", params: { sport: "football" } });
});

onUnmounted(() => {
  stopSportsSession();
  closeFootballSettings();
});

watch(sport, (code) => {
  if (code !== "football")
    closeFootballSettings();
});

async function logout() {
  stopSportsSession();
  try {
    if (await user.logout() === false) return;
    await router.replace({ name: "home" });
  }
  catch (err) { ElMessage.error(err instanceof Error ? err.message : "退出未完成，请重试"); }
}

function goSport(code: SportCode) {
  if (code === sport.value)
    return;
  void router.push({ name: "sports-board", params: { sport: code } });
}

function onSportTab(v: string | number | boolean | undefined) {
  const code = String(v ?? "");
  if ((SPORTS as readonly string[]).includes(code))
    goSport(code as SportCode);
}
</script>

<template>
  <AccountEditDialog
    :open="editDialogOpen"
    :account="editDialogAccount"
    @close="accountStore.closeAccountDialog()"
  />
  <FootballSettingsDialog />
  <PodFollowPanel v-if="sport === 'football'" />
  <el-container class="common-layout home-view sports-workspace">
    <el-aside width="300px">
      <AppSidebar
        workspace="sports"
        :show-football-settings="sport === 'football'"
        @logout="logout"
        @open-football-settings="openFootballSettings"
      />
    </el-aside>
    <el-container>
      <el-header>
        <AccountBar workspace="sports" />
        <div class="home-header-trailing">
          <DirectRealtimeBadge workspace="sports" />
        </div>
        <p v-if="extensionChecked && !extensionReady" class="extension-banner">
          扩展未连通，部分场馆能力不可用。
          <el-button link type="primary" @click="refreshExtension">
            重新检测
          </el-button>
        </p>
      </el-header>
      <el-main class="home-main">
        <div class="sport-tab-row">
          <el-radio-group :model-value="sport" size="small" class="sport-tab" @update:model-value="onSportTab">
            <el-radio-button value="football">
              足球
            </el-radio-button>
            <el-radio-button value="basketball">
              篮球
            </el-radio-button>
            <el-radio-button value="baseball">
              棒球
            </el-radio-button>
            <el-radio-button value="tennis">
              网球
            </el-radio-button>
          </el-radio-group>
        </div>
        <FootballBoard v-if="sport === 'football'" />
        <BasketballBoard v-else-if="sport === 'basketball'" />
        <BaseballBoard v-else-if="sport === 'baseball'" />
        <TennisBoard v-else-if="sport === 'tennis'" />
      </el-main>
    </el-container>
  </el-container>
</template>
