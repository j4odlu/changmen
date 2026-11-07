<script setup lang="ts">
import type { Store } from "pinia";
import type { ViewMatch } from "@/models/match";
import { storeToRefs } from "pinia";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import MatchCard from "@/components/match/MatchCard.vue";
import MakeupCalcBar from "@/components/user/MakeupCalcBar.vue";
import {
  startSportLiveOddsSession,
  type SportLiveOddsSession,
} from "@/runtime/sportLiveOdds";
import { FOOTBALL_LIVE_LOOKBACK_MS, filterSportBoardMatches } from "@/runtime/sportBoardFilter";
import { useSportOddsStore } from "@/stores/sportOddsStore";

/** 非电竞只读列表板：与电竞 .matchs 同级挂在 home-main */
export type SportListStore = Store<
  string,
  {
    matchs: ViewMatch[];
    loading: boolean;
    refreshing: boolean;
    error: string | null;
  },
  object,
  {
    fetchMatchs: (force?: boolean) => Promise<void>;
    startPolling: () => void;
    stopPolling: () => void;
  }
>;

const props = withDefaults(defineProps<{
  store: SportListStore;
  metaLabel: string;
  emptyLabel: string;
  /** 默认只显示该窗口内的开赛（小时）；0/不传 = 全部 */
  upcomingHours?: number;
}>(), {
  upcomingHours: 0,
});

const { matchs, loading, refreshing, error } = storeToRefs(props.store);
/** 体育实时盘显示时钟；只由本板注入 MatchCard，电竞 BetRow 不依赖 sportOddsStore */
const { tick: oddsDisplayTick } = storeToRefs(useSportOddsStore());

const searchQuery = ref("");
const nowTick = ref(Date.now());
let nowTimer: ReturnType<typeof setInterval> | null = null;

const horizonMs = computed(() => {
  const h = Number(props.upcomingHours) || 0;
  return h > 0 ? h * 3600 * 1000 : 0;
});

const displayedMatchs = computed(() => {
  void nowTick.value;
  return filterSportBoardMatches(matchs.value, {
    query: searchQuery.value,
    horizonMs: horizonMs.value || undefined,
    lookbackMs: FOOTBALL_LIVE_LOOKBACK_MS,
    now: nowTick.value,
  });
});

const matchCountLabel = computed(() => {
  const total = matchs.value.length;
  const shown = displayedMatchs.value.length;
  if (shown !== total)
    return `${shown} / ${total} 场`;
  return `${shown} 场`;
});

let liveSession: SportLiveOddsSession | null = null;

onMounted(() => {
  // 仅当前 Tab 挂载时轮询；切换 Tab（v-if 卸载）会 stopPolling。与电竞 mainBetLoop 无关。
  props.store.startPolling();
  liveSession = startSportLiveOddsSession(() => displayedMatchs.value);
  if (horizonMs.value > 0)
    nowTimer = setInterval(() => { nowTick.value = Date.now(); }, 15_000);
});

onUnmounted(() => {
  props.store.stopPolling();
  liveSession?.stop();
  liveSession = null;
  if (nowTimer) {
    clearInterval(nowTimer);
    nowTimer = null;
  }
});

watch(
  () => displayedMatchs.value.map(m => m.id).join(","),
  () => {
    liveSession?.sync();
  },
);
</script>

<template>
  <div class="sport-board">
    <div class="match-search-row sport-toolbar">
      <el-input
        v-model="searchQuery"
        placeholder="搜索队名 / 比赛ID / 游戏..."
        clearable
        class="match-search"
      />
      <span class="match-count" :title="`当前列表 ${displayedMatchs.length} 场`">
        {{ matchCountLabel }}
      </span>
      <span class="sport-toolbar__meta">
        {{ metaLabel }}
      </span>
      <MakeupCalcBar />
      <el-button link type="primary" :loading="loading || refreshing" @click="store.fetchMatchs(true)">
        刷新
      </el-button>
    </div>
    <p v-if="error" class="sport-toolbar__error">
      {{ error }}
    </p>
    <div v-if="displayedMatchs.length" class="matchs">
      <div v-for="m in displayedMatchs" :key="m.id" class="sport-match-wrap">
        <MatchCard
          :match="m"
          :odds-display-tick="oddsDisplayTick"
          quote-scope="sport"
          :allow-betting="false"
        />
      </div>
    </div>
    <div v-else-if="!loading && !error" class="match-empty">
      {{ searchQuery.trim() ? "没有匹配的比赛" : emptyLabel }}
    </div>
  </div>
</template>

<style scoped>
.sport-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  max-width: none;
}
.sport-toolbar__meta {
  flex: 0 1 auto;
  font-size: 13px;
  color: #94a3b8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sport-toolbar__error {
  flex: 0 0 auto;
  margin: 0 10px 8px;
  color: #f56c6c;
  font-size: 13px;
}
.sport-toolbar :deep(.el-button) {
  margin-left: auto;
}
</style>
