<script setup lang="ts">
import { ElMessage } from "element-plus";
import { storeToRefs } from "pinia";
import { computed, onActivated, onMounted, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import AccountBar from "@/components/account/AccountBar.vue";
import AccountEditDialog from "@/components/account/AccountEditDialog.vue";
import AppSidebar from "@/components/layout/AppSidebar.vue";
import DirectRealtimeBadge from "@/components/layout/DirectRealtimeBadge.vue";
import CreateLoseDialog from "@/components/match/CreateLoseDialog.vue";
import MatchCard from "@/components/match/MatchCard.vue";
import ActiveBetRunView from "@/components/order/ActiveBetRunView.vue";
import MakeupCalcBar from "@/components/user/MakeupCalcBar.vue";
import { useExtensionGate } from "@/composables/useExtensionGate";
import {
  mapBetMuteFullMatchGlobal,
  mapBetMuteGlobal,
  toggleFullMatchMuteGlobal,
  toggleMapMuteGlobal,
} from "@/extensions/mapBetMute";
import PmOddsDropSignalPanel from "@/extensions/pmOddsDropSignal/PmOddsDropSignalPanel.vue";
import {
  filterMatchesForPrematchFull,
  prematchFullMode,
  setPrematchFullMode,
} from "@/extensions/prematchFullOnly";
import {
  mountAppSession,
  stopAppSession,
} from "@/runtime/appSession";
import { useAccountStore } from "@/stores/accountStore";
import { useCreateLoseDialogStore } from "@/stores/createLoseDialogStore";
import { useMatchStore } from "@/stores/matchStore";
import { useUserStore } from "@/stores/userStore";

const router = useRouter();
const user = useUserStore();
const matchStore = useMatchStore();
const accountStore = useAccountStore();
const createLoseDialog = useCreateLoseDialogStore();
const { matchs } = storeToRefs(matchStore);
const { editDialogOpen, editDialogAccount } = storeToRefs(accountStore);
const {
  open: createLoseOpen,
  match: createLoseMatch,
  bet: createLoseBet,
} = storeToRefs(createLoseDialog);

const searchQuery = ref("");
const { extensionReady, extensionChecked, refreshExtension } = useExtensionGate();

/** [changmen 扩展] 全局折叠：所有比赛全场 + 各地图 */
const muteGlobalRef = mapBetMuteGlobal();
const mapMuteGlobalOn = computed(() => muteGlobalRef.value);

function onToggleMapMuteGlobal() {
  toggleMapMuteGlobal();
}

/** [changmen 扩展] 一键关闭所有全场胜负；地图盘口保持正常 */
const muteFullMatchGlobalRef = mapBetMuteFullMatchGlobal();
const fullMatchMuteGlobalOn = computed(() => muteFullMatchGlobalRef.value);

function onToggleFullMatchMuteGlobal() {
  toggleFullMatchMuteGlobal();
}

/** [changmen 扩展] 只看赛前全场；默认 off，与折叠正交 */
const prematchModeRef = prematchFullMode();
const prematchFullOn = computed(() => prematchModeRef.value !== "off");
const prematchMode = computed(() => prematchModeRef.value);
// [changmen 扩展] 展示全部盘口供手动下注，自动下注仍按赛前全场设置过滤。
const showAllMarketsForManual = ref(false);

function onTogglePrematchFull() {
  if (prematchModeRef.value === "off")
    setPrematchFullMode("liveRound");
  else
    setPrematchFullMode("off");
}

/** 开赛时间模式：到点后刷新列表；其它模式不挂定时器 */
const startAtTick = ref(0);
let startAtTickTimer: ReturnType<typeof setInterval> | null = null;

watch(prematchModeRef, (mode) => {
  showAllMarketsForManual.value = false;
  if (mode === "startAt") {
    startAtTick.value = Date.now();
    if (!startAtTickTimer)
      startAtTickTimer = setInterval(() => { startAtTick.value = Date.now(); }, 5000);
    return;
  }
  if (startAtTickTimer) {
    clearInterval(startAtTickTimer);
    startAtTickTimer = null;
  }
}, { immediate: true });

/** 新标签打开体育页，本页电竞 runtime 继续跑 */
function openSportsInNewTab() {
  const href = router.resolve({ name: "sports-board", params: { sport: "football" } }).href;
  window.open(href, "_blank", "noopener,noreferrer");
}

const filteredMatchs = computed(() => {
  void startAtTick.value;
  void prematchModeRef.value;
  const q = searchQuery.value.trim().toLowerCase();
  const searched = !q
    ? matchs.value
    : matchs.value.filter((m) => {
        if (String(m.id).includes(q))
          return true;
        if (m.title.toLowerCase().includes(q))
          return true;
        if (m.game.toLowerCase().includes(q))
          return true;
        return m.bets.some(
          b => b.homeName.toLowerCase().includes(q) || b.awayName.toLowerCase().includes(q),
        );
      });
  return showAllMarketsForManual.value ? searched : filterMatchesForPrematchFull(searched);
});

const matchCountLabel = computed(() => {
  const total = matchs.value.length;
  const shown = filteredMatchs.value.length;
  if (shown !== total)
    return `${shown} / ${total} 场`;
  return `${shown} 场`;
});

/** [A8 可证实] xo：await getUserInfo(), loadAccounts — 解锁本机钱包后再 startAppSession */
onMounted(() => {
  void mountAppSession();
});

/** [A8 可证实] zt：await initBetTarget() */
onActivated(async () => {
  await matchStore.initBetTarget();
});

watch(extensionReady, (ext) => {
  if (!ext)
    return;
  void import("@changmen/venue-adapter/stake").then(({ primeStakeTabId }) => primeStakeTabId());
});

onUnmounted(() => {
  if (startAtTickTimer) {
    clearInterval(startAtTickTimer);
    startAtTickTimer = null;
  }
  stopAppSession();
});

async function logout() {
  stopAppSession();
  try { await user.logout(); }
  catch (err) { ElMessage.error(err instanceof Error ? err.message : "退出未完成，请重试"); }
}
</script>

<template>
  <AccountEditDialog
    :open="editDialogOpen"
    :account="editDialogAccount"
    @close="accountStore.closeAccountDialog()"
  />
  <!-- [A8 可证实] HomeView 单例 CreateLoseView：v-if + match/bet/close -->
  <CreateLoseDialog
    v-if="createLoseOpen && createLoseMatch && createLoseBet"
    :match="createLoseMatch"
    :bet="createLoseBet"
    @close="createLoseDialog.close()"
  />
  <PmOddsDropSignalPanel />
  <el-container class="common-layout home-view">
    <el-aside width="300px">
      <AppSidebar @logout="logout" />
    </el-aside>
    <el-container>
      <el-header>
        <AccountBar />
        <div class="home-header-trailing">
          <DirectRealtimeBadge />
        </div>
        <p v-if="extensionChecked && !extensionReady" class="extension-banner">
          扩展未连通，采集/下注不可用。
          <el-button link type="primary" @click="refreshExtension">
            重新检测
          </el-button>
        </p>
      </el-header>
      <el-main class="home-main">
        <ActiveBetRunView />
        <div class="sport-board">
          <div class="match-search-row">
            <el-input
              v-model="searchQuery"
              placeholder="搜索队名 / 比赛ID / 游戏..."
              clearable
              class="match-search"
            />
            <span class="match-count" :title="`当前列表 ${filteredMatchs.length} 场`">
              {{ matchCountLabel }}
            </span>
            <button
              type="button"
              class="map-mute-global-toggle"
              :class="{ 'is-on': mapMuteGlobalOn }"
              :title="mapMuteGlobalOn
                ? '展开全部盘口（会清空单行折叠/例外）；各图仍可单独开关'
                : '默认折叠全部比赛的全场与各地图；各图仍可单独展开'"
              :aria-pressed="mapMuteGlobalOn"
              @click="onToggleMapMuteGlobal"
            >
              {{ mapMuteGlobalOn ? "开" : "关" }} 全部盘口
            </button>
            <button
              type="button"
              class="map-mute-global-toggle"
              :class="{ 'is-on': fullMatchMuteGlobalOn }"
              :title="fullMatchMuteGlobalOn
                ? '恢复全部全场胜负；地图盘口不受影响'
                : '一键折叠并禁止所有全场胜负新开仓；地图盘口保持正常'"
              :aria-pressed="fullMatchMuteGlobalOn"
              @click="onToggleFullMatchMuteGlobal"
            >
              {{ fullMatchMuteGlobalOn ? "开" : "关" }} 全场胜负
            </button>
            <div class="prematch-full-toggle-group">
              <button
                type="button"
                class="map-mute-global-toggle"
                :class="{ 'is-on': prematchFullOn }"
                :title="prematchFullOn
                  ? '关闭后恢复显示全部盘口；不改折叠、不拦补单'
                  : '默认只显示未开赛的全场盘口；自动下注仅允许这些盘口，手动可查看全部。无 OB 时「OB开打」无法判断是否已开赛'"
                :aria-pressed="prematchFullOn"
                @click="onTogglePrematchFull"
              >
                {{ prematchFullOn ? "开" : "关" }} 赛前全场
              </button>
              <button
                v-if="prematchFullOn"
                type="button"
                class="map-mute-global-toggle"
                :aria-pressed="showAllMarketsForManual"
                title="只改变显示范围，自动下注仍按赛前全场过滤"
                @click="showAllMarketsForManual = !showAllMarketsForManual"
              >
                {{ showAllMarketsForManual ? "只看赛前全场" : "查看全部盘口（手动）" }}
              </button>
              <span
                v-if="prematchFullOn"
                class="prematch-full-criteria"
                role="group"
                aria-label="赛前判定方式"
              >
                <button
                  type="button"
                  class="prematch-full-criteria-btn"
                  :class="{ 'is-on': prematchMode === 'liveRound' }"
                  title="用 OB 开打状态（liveRound）。没挂 OB 的场会一直当未开赛"
                  :aria-pressed="prematchMode === 'liveRound'"
                  @click="setPrematchFullMode('liveRound')"
                >
                  OB开打
                </button>
                <button
                  type="button"
                  class="prematch-full-criteria-btn"
                  :class="{ 'is-on': prematchMode === 'startAt' }"
                  title="用开赛时间：当前时间到点即视为已开赛，延迟开赛的全场会被藏掉"
                  :aria-pressed="prematchMode === 'startAt'"
                  @click="setPrematchFullMode('startAt')"
                >
                  开赛时间
                </button>
              </span>
            </div>
            <MakeupCalcBar />
            <el-button
              class="sports-open-btn"
              size="small"
              type="primary"
              plain
              title="新标签打开体育页（本页电竞继续运行）"
              @click="openSportsInNewTab"
            >
              体育
            </el-button>
          </div>
          <div v-if="filteredMatchs.length" class="matchs">
            <MatchCard v-for="m in filteredMatchs" :key="m.id" :match="m" :data-match-id="m.id" />
          </div>
          <div v-else-if="searchQuery" class="match-empty">
            无匹配比赛
          </div>
          <div v-else-if="prematchFullOn" class="match-empty">
            无赛前全场
          </div>
        </div>
      </el-main>
    </el-container>
  </el-container>
</template>
