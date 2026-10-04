<script setup lang="ts">
import FootballLazyBook from "@/components/football/FootballLazyBook.vue";
import FootballMatchCard from "@/components/football/FootballMatchCard.vue";
import { footballLeagueKey, groupFootballMatchesByLeague } from "@/runtime/footballLeague";
import { sportMatchStableKey } from "@/runtime/sportListPatch";
import { FOOTBALL_VENUE_TABS, footballMatchInVenue, footballMatchVenue, type FootballVenueTab } from "@/runtime/footballBoardVenues";
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
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from "vue";

const football = useFootballStore();
const { matchs, loading, refreshing, error } = storeToRefs(football);
const obLive = useObSportLiveStore();
const { listRev } = storeToRefs(obLive);

// [changmen 扩展] 场馆 tab 只筛选展示；采集、赔率订阅与跟单继续使用全场馆数据。
const venueTab = ref<FootballVenueTab>("all");
const tabPrefs = reactive(Object.fromEntries(FOOTBALL_VENUE_TABS.map(tab => [tab.key, {
  query: "", league: "", showLive: readFootballBoardShowLive(), scrollTop: 0,
}])) as Record<FootballVenueTab, { query: string; league: string; showLive: boolean; scrollTop: number }>);
const searchQuery = computed({ get: () => tabPrefs[venueTab.value].query, set: v => { tabPrefs[venueTab.value].query = v; } });
const leagueFilter = computed({ get: () => tabPrefs[venueTab.value].league, set: v => { tabPrefs[venueTab.value].league = v; } });
const showLive = computed({ get: () => tabPrefs[venueTab.value].showLive, set: v => { tabPrefs[venueTab.value].showLive = v; } });
const nowTick = ref(Date.now());
const matchsEl = ref<HTMLElement | null>(null);
let nowTimer: ReturnType<typeof setInterval> | null = null;
let liveSession: SportLiveOddsSession | null = null;

async function switchVenue(venue: FootballVenueTab) {
  if (venue === venueTab.value)
    return;
  tabPrefs[venueTab.value].scrollTop = matchsEl.value?.scrollTop ?? 0;
  clearPodFlash();
  venueTab.value = venue;
  await nextTick();
  if (venueTab.value === venue && matchsEl.value)
    matchsEl.value.scrollTop = tabPrefs[venue].scrollTop;
}

const venueMatchs = computed(() => matchs.value.filter(m => footballMatchInVenue(m, venueTab.value)));
const venueTabs = computed(() => FOOTBALL_VENUE_TABS.map(tab => ({
  ...tab, n: matchs.value.filter(m => footballMatchInVenue(m, tab.key)).length,
})));

// 保留全场馆窗口，并补订各 tab 搜索到的远场与跟单定位场次。
const liveMatchs = computed(() => {
  const rows = filterSportBoardMatches(matchs.value, {
    horizonMs: FOOTBALL_UPCOMING_MS,
    lookbackMs: FOOTBALL_LIVE_LOOKBACK_MS,
    now: nowTick.value,
    showLive: true,
  });
  const seen = new Set(rows.map(sportMatchStableKey));
  const add = (match: (typeof matchs.value)[number]) => {
    const key = sportMatchStableKey(match);
    if (!seen.has(key)) {
      seen.add(key);
      rows.push(match);
    }
  };
  for (const tab of FOOTBALL_VENUE_TABS) {
    const query = tabPrefs[tab.key].query.trim();
    if (!query)
      continue;
    for (const match of filterSportBoardMatches(matchs.value, { query, now: nowTick.value })) {
      if (footballMatchInVenue(match, tab.key))
        add(match);
    }
  }
  const focus = podBoardFocus.value;
  const pinned = focus && matchs.value.find(m => sportMatchStableKey(m) === podBoardFocusMatchKey(focus));
  if (pinned)
    add(pinned);
  return rows;
});

function onMatchsWheel(e: WheelEvent) {
  const el = matchsEl.value;
  if (!el)
    return;
  onNestedVerticalWheel(el, e);
}

const displayedMatchs = computed(() => {
  void nowTick.value;
  return filterSportBoardMatches(venueMatchs.value, {
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
  const pinned = venueMatchs.value.find(m => sportMatchStableKey(m) === key);
  if (!pinned)
    return rows;
  return [pinned, ...rows];
});

const matchCountLabel = computed(() => {
  const total = venueMatchs.value.length;
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
  liveSession = startSportLiveOddsSession(() => liveMatchs.value, { patchMatchFallback: false });
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
  () => liveMatchs.value.map(m => sportMatchStableKey(m)).join(","),
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

async function waitEl(find: () => HTMLElement | null, isCurrent: () => boolean, ms = 4000): Promise<HTMLElement | null> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (!isCurrent())
      return null;
    const el = find();
    if (el)
      return el;
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }
  return isCurrent() ? find() : null;
}

watch(podBoardFocus, async (target, _previous, onCleanup) => {
  if (!target)
    return;
  let cancelled = false;
  onCleanup(() => { cancelled = true; });
  const match = matchs.value.find(m => sportMatchStableKey(m) === podBoardFocusMatchKey(target));
  const venue = match ? footballMatchVenue(match) : target.obMid ? "OB" : "all";
  const isCurrent = () => !cancelled && venueTab.value === venue;
  await switchVenue(venue);
  if (!isCurrent())
    return;
  searchQuery.value = "";
  leagueFilter.value = "";
  await nextTick();
  const matchEl = await waitEl(() => selectPodBoardMatch(matchsEl.value, target), isCurrent);
  if (!matchEl || !isCurrent())
    return;
  matchEl.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
  const cell = await waitEl(() => selectPodBoardCell(matchEl, target), isCurrent);
  if (!isCurrent())
    return;
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
    <div class="football-venue-tabs" role="tablist" aria-label="按场馆筛选比赛">
      <button
        v-for="tab in venueTabs"
        :key="tab.key"
        type="button"
        class="football-league-tab"
        :class="{ 'is-on': venueTab === tab.key }"
        role="tab"
        :aria-selected="venueTab === tab.key"
        :title="`已采集 ${tab.n} 场，下方按时间和筛选条件显示`"
        @click="switchVenue(tab.key)"
      >
        {{ tab.label }} {{ tab.n }}
      </button>
      <span class="football-venue-hint">跟单按设置持续运行，切换场馆不影响跟单</span>
    </div>
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
.football-venue-tabs,
.football-league-tabs {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 10px 8px;
}
.football-venue-tabs {
  align-items: center;
  padding-top: 8px;
}
.football-venue-hint {
  color: #94a3b8;
  font-size: 12px;
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
