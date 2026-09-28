<script setup lang="ts">
import FootballLazyBook from "@/components/football/FootballLazyBook.vue";
import FootballMatchCard from "@/components/football/FootballMatchCard.vue";
import { footballLeagueKey, groupFootballMatchesByLeague } from "@/runtime/footballLeague";
import { sportMatchStableKey } from "@/runtime/sportListPatch";
import {
  FOOTBALL_LIVE_LOOKBACK_MS,
  FOOTBALL_UPCOMING_MS,
  filterSportBoardMatches,
} from "@/runtime/sportBoardFilter";
import {
  readFootballBoardShowLive,
  writeFootballBoardShowLive,
} from "@/runtime/footballBoardPrefs";
import {
  startSportLiveOddsSession,
  type SportLiveOddsSession,
} from "@/runtime/sportLiveOdds";
import { onNestedVerticalWheel } from "@/runtime/footballBoardScroll";
import { listObFootballLivePatches } from "@/runtime/obSportFootballFetch";
import {
  podBoardFocus,
  podBoardFocusMatchKey,
  selectPodBoardCell,
  selectPodBoardMatch,
} from "@/runtime/podBoardFocus";
import { useFootballStore } from "@/stores/footballStore";
import { useObSportLiveStore } from "@/stores/obSportLiveStore";
import { storeToRefs } from "pinia";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";

const football = useFootballStore();
const { matchs, loading, refreshing, error } = storeToRefs(football);
const obLive = useObSportLiveStore();
const { listRev } = storeToRefs(obLive);

const searchQuery = ref("");
const leagueFilter = ref("");
const showLive = ref(readFootballBoardShowLive());
const nowTick = ref(Date.now());
const matchsEl = ref<HTMLElement | null>(null);
let nowTimer: ReturnType<typeof setInterval> | null = null;
let liveSession: SportLiveOddsSession | null = null;

function onMatchsWheel(e: WheelEvent) {
  const el = matchsEl.value;
  if (!el)
    return;
  onNestedVerticalWheel(el, e);
}

const displayedMatchs = computed(() => {
  void nowTick.value;
  return filterSportBoardMatches(matchs.value, {
    query: searchQuery.value,
    horizonMs: FOOTBALL_UPCOMING_MS,
    lookbackMs: FOOTBALL_LIVE_LOOKBACK_MS,
    now: nowTick.value,
    showLive: showLive.value,
  });
});

const horizonHint = computed(() => (
  showLive.value
    ? "预测市场 / RAY 2小时 · OB 2小时/滚球"
    : "预测市场 / RAY 2小时 · OB 2小时（不含滚球）"
));

watch(showLive, (v) => {
  writeFootballBoardShowLive(v);
});

const leagueTabs = computed(() => {
  return groupFootballMatchesByLeague(displayedMatchs.value).map(g => ({
    key: g.key,
    label: g.league,
    n: g.matches.length,
  }));
});

const visibleMatchs = computed(() => {
  const want = leagueFilter.value;
  const rows = want
    ? displayedMatchs.value.filter(m => footballLeagueKey(m.game, m.league) === want)
    : displayedMatchs.value;
  const t = podBoardFocus.value;
  if (!t)
    return rows;
  const key = podBoardFocusMatchKey(t);
  if (rows.some(m => sportMatchStableKey(m) === key))
    return rows;
  const pinned = matchs.value.find(m => sportMatchStableKey(m) === key);
  if (!pinned)
    return rows;
  return [pinned, ...rows];
});

const matchCountLabel = computed(() => {
  const total = matchs.value.length;
  const shown = visibleMatchs.value.length;
  if (shown !== total)
    return `${shown} / ${total} 场`;
  return `${shown} 场`;
});

watch(displayedMatchs, () => {
  if (!leagueFilter.value)
    return;
  if (!leagueTabs.value.some(t => t.key === leagueFilter.value))
    leagueFilter.value = "";
});

onMounted(() => {
  football.startPolling();
  liveSession = startSportLiveOddsSession(() => displayedMatchs.value, { patchMatchFallback: false });
  nowTimer = setInterval(() => { nowTick.value = Date.now(); }, 15_000);
});

watch(matchsEl, (el, prev) => {
  prev?.removeEventListener("wheel", onMatchsWheel);
  el?.addEventListener("wheel", onMatchsWheel, { passive: false });
}, { immediate: true });

const FLASH_MS = 2400;
let flashTimer: ReturnType<typeof setTimeout> | null = null;
let flashCell: HTMLElement | null = null;

function clearPodFlash() {
  if (flashTimer) {
    clearTimeout(flashTimer);
    flashTimer = null;
  }
  flashCell?.classList.remove("is-pod-flash");
  flashCell = null;
}

onUnmounted(() => {
  matchsEl.value?.removeEventListener("wheel", onMatchsWheel);
  football.stopPolling();
  liveSession?.stop();
  liveSession = null;
  if (nowTimer) {
    clearInterval(nowTimer);
    nowTimer = null;
  }
  clearPodFlash();
});

function seedLiveFromHttp() {
  for (const patch of listObFootballLivePatches()) {
    const cur = obLive.get(patch.mid);
    if (cur && (cur.home != null || cur.elapsedSec > 0 || Number(cur.ms) === 1))
      continue;
    obLive.applyLive(patch);
  }
}

watch(matchs, seedLiveFromHttp, { immediate: true });

watch(listRev, () => {
  void football.fetchMatchs();
});

watch(
  () => displayedMatchs.value.map(m => String(m.providers?.OB || m.id)).join(","),
  () => {
    liveSession?.sync();
  },
);

function isFocusMatch(m: { id?: number; providers?: Record<string, string | number> }) {
  const t = podBoardFocus.value;
  if (!t)
    return false;
  return sportMatchStableKey(m) === podBoardFocusMatchKey(t);
}

async function waitEl(find: () => HTMLElement | null, ms = 4000): Promise<HTMLElement | null> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const el = find();
    if (el)
      return el;
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }
  return find();
}

watch(() => podBoardFocus.value?.token, async (token) => {
  const target = podBoardFocus.value;
  if (!token || !target)
    return;
  searchQuery.value = "";
  leagueFilter.value = "";
  await nextTick();
  const matchEl = await waitEl(() => selectPodBoardMatch(matchsEl.value, target));
  if (!matchEl)
    return;
  matchEl.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
  const cell = await waitEl(() => selectPodBoardCell(matchEl, target));
  clearPodFlash();
  if (!cell)
    return;
  flashCell = cell;
  cell.classList.add("is-pod-flash");
  cell.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
  flashTimer = setTimeout(clearPodFlash, FLASH_MS);
}, { flush: "post" });
</script>

<template>
  <div class="football-board-list">
    <div class="match-search-row sport-toolbar">
      <el-input
        v-model="searchQuery"
        placeholder="搜索队名 / 联赛 / 比赛ID"
        clearable
        class="match-search"
      />
      <el-checkbox v-model="showLive" class="match-show-live">
        显示滚球
      </el-checkbox>
      <span class="match-count" :title="`当前列表 ${displayedMatchs.length} 场`">
        {{ matchCountLabel }}
      </span>
      <span class="sport-toolbar__meta">
        {{ horizonHint }}
      </span>
      <el-button link type="primary" :loading="loading || refreshing" @click="football.fetchMatchs(true)">
        刷新
      </el-button>
    </div>
    <p v-if="error" class="sport-toolbar__error">
      {{ error }}
    </p>
    <div v-if="leagueTabs.length" class="football-league-tabs" role="tablist" aria-label="按联赛筛选">
      <button
        type="button"
        class="football-league-tab"
        :class="{ 'is-on': !leagueFilter }"
        role="tab"
        :aria-selected="!leagueFilter"
        @click="leagueFilter = ''"
      >
        全部 {{ displayedMatchs.length }}
      </button>
      <button
        v-for="tab in leagueTabs"
        :key="tab.key"
        type="button"
        class="football-league-tab"
        :class="{ 'is-on': leagueFilter === tab.key }"
        role="tab"
        :aria-selected="leagueFilter === tab.key"
        @click="leagueFilter = leagueFilter === tab.key ? '' : tab.key"
      >
        {{ tab.label }} {{ tab.n }}
      </button>
    </div>
    <div v-if="visibleMatchs.length" ref="matchsEl" class="matchs">
      <div
        v-for="m in visibleMatchs"
        :key="sportMatchStableKey(m)"
        class="match football-match"
        :class="{ 'is-pod-focus': isFocusMatch(m) }"
        :data-pod-match="sportMatchStableKey(m)"
      >
        <FootballMatchCard :match="m" />
        <FootballLazyBook :match="m" :force-on="isFocusMatch(m)" />
      </div>
    </div>
    <div v-else-if="!loading && !error" class="match-empty">
      {{ searchQuery.trim() ? "没有匹配的比赛" : "暂无足球比赛" }}
    </div>
  </div>
</template>

<style scoped>
.football-board-list {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
.football-match {
  min-width: 0;
}
.football-match.is-pod-focus {
  outline: 1px solid #f59e0b88;
  border-radius: 10px;
}
.football-board-list .match-search-row {
  flex: 0 0 auto;
}
.match-show-live {
  flex: 0 0 auto;
  margin: 0;
  white-space: nowrap;
  color: #cbd5e1;
}
.match-show-live :deep(.el-checkbox__label) {
  color: #cbd5e1;
  font-size: 13px;
  padding-left: 6px;
}
.football-board-list .matchs,
.football-board-list .match-empty {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}
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
.football-league-tabs {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 10px 8px;
}
.football-league-tab {
  border: 1px solid #334155;
  border-radius: 999px;
  background: #1a2332;
  color: #cbd5e1;
  font-size: 12px;
  line-height: 1;
  padding: 6px 10px;
  cursor: pointer;
}
.football-league-tab.is-on {
  border-color: #3b82f6;
  background: #1e3a5f;
  color: #fff;
}
</style>
