<script setup lang="ts">
import FootballMarketSection from "@/components/football/FootballMarketSection.vue";
import type { ViewMatch } from "@/models/match";
import {
  groupFootballColumns,
  splitFootballTeams,
  type FootballBookColumn,
} from "@/runtime/footballMarketLayout";
import { isObFootballPlaceholderTitle } from "@/runtime/obSportFootballFetch";
import {
  obChineseNamesRev,
  peekObChineseNames,
} from "@/runtime/obSportChineseNames";
import { peekObEnglishNames } from "@/runtime/obSportEnglishNames";
import {
  invalidateFootballObMarkets,
  isFootballObMarketsComplete,
  loadFootballObMarkets,
  peekFootballObMarkets,
  type FootballObMarketRow,
} from "@/runtime/footballObMarkets";
import { viewBetsToMarketRows, mergeFootballBookRows } from "@/runtime/footballMarketRows";
import { useObSportLiveStore } from "@/stores/obSportLiveStore";
import { computed, ref, watch } from "vue";
import { storeToRefs } from "pinia";

const props = defineProps<{
  match: ViewMatch;
}>();

const loading = ref(false);
const error = ref("");
const obRows = ref<FootballObMarketRow[]>([]);
let fetchGen = 0;

const obLive = useObSportLiveStore();
const { playRevByMid } = storeToRefs(obLive);

const obMid = computed(() => String(props.match.providers?.OB || "").trim());
const teams = computed(() => {
  void obChineseNamesRev.value;
  const title = String(props.match.title || "");
  const mid = obMid.value;
  if (isObFootballPlaceholderTitle(title, mid, String(props.match.game || ""))) {
    const zh = mid ? peekObChineseNames(mid) : null;
    if (zh?.home && zh?.away)
      return { home: zh.home, away: zh.away };
    const en = mid ? peekObEnglishNames(mid) : null;
    if (en?.home && en?.away)
      return { home: en.home, away: en.away };
  }
  return splitFootballTeams(title);
});

/** HTTP 结构稳定；实时价由 FootballOddsCell 按 oid 读 sportOddsStore，不订全局 tick。 */
const listRows = computed(() => viewBetsToMarketRows(props.match));
// 列表已包含全场/半场独赢、让球、大小；锁盘的 0 赔率也属于有效结构。
const hasObListMarkets = computed(() => listRows.value.some(row => row.Venues?.some(
  venue => venue.venue === "OB" && venue.Selections.some(selection => !!selection.OddID),
)));

const allRows = computed(() => mergeFootballBookRows(listRows.value, hasObListMarkets.value ? [] : obRows.value));

const columns = computed((): FootballBookColumn[] => groupFootballColumns(allRows.value));

async function fetchAllMarkets(force = false) {
  const mid = obMid.value;
  const gen = ++fetchGen;
  if (hasObListMarkets.value || !mid) {
    obRows.value = [];
    loading.value = false;
    error.value = "";
    return;
  }
  if (force)
    invalidateFootballObMarkets(mid);
  const cached = peekFootballObMarkets(mid);
  if (cached)
    obRows.value = cached;
  const hasRows = (cached?.length || 0) > 0 || obRows.value.length > 0 || listRows.value.length > 0;
  if (!force && cached && isFootballObMarketsComplete(cached))
    return;
  if (!hasRows)
    loading.value = true;
  error.value = "";
  try {
    const rows = await loadFootballObMarkets(mid, force);
    if (gen !== fetchGen)
      return;
    obRows.value = rows;
  }
  catch (err) {
    if (gen !== fetchGen)
      return;
    error.value = err instanceof Error ? err.message : String(err);
  }
  finally {
    if (gen === fetchGen)
      loading.value = false;
  }
}

watch(
  () => [obMid.value, hasObListMarkets.value, playRevByMid.value[obMid.value] || 0] as const,
  ([mid, , rev], prev) => {
    if (mid !== prev?.[0]) {
      obRows.value = [];
      loading.value = false;
      error.value = "";
    }
    void fetchAllMarkets(mid === prev?.[0] && !!rev && rev !== prev?.[2]);
  },
  { immediate: true },
);
</script>

<template>
  <div
    v-if="obMid || columns.length"
    class="fb-book"
  >
    <div v-if="columns.length" class="fb-book__cols">
      <section
        v-for="col in columns"
        :key="col.id"
        class="fb-book__col"
        :class="`fb-book__col--${col.id}`"
      >
        <div class="fb-book__col-head">
          {{ col.label }}
        </div>
        <FootballMarketSection
          v-for="sec in col.sections"
          :key="sec.key"
          :section="sec"
          :home="teams.home"
          :away="teams.away"
          :mid="obMid"
          :show-title="col.sections.length > 1 || sec.title !== col.label"
        />
      </section>
    </div>
    <div v-if="loading && !columns.length" class="fb-book__hint">
      加载盘口…
    </div>
    <div v-else-if="error" class="fb-book__hint err">
      {{ error }}
    </div>
  </div>
</template>

<style scoped>
.fb-book {
  width: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 0 4px;
}
.fb-book__cols {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-items: stretch;
  gap: 8px;
  overflow: visible;
  padding-bottom: 4px;
}
.fb-book__col {
  flex: 1 1 0;
  min-width: 0;
  background: hsla(0, 0%, 100%, 0.04);
  border-radius: 8px;
  overflow: visible;
}
.fb-book__col--ml,
.fb-book__col--ht_ml {
  flex: 1.2 1 0;
}
.fb-book__col-head {
  padding: 8px 10px;
  font-size: 13px;
  font-weight: 600;
  color: hsla(0, 0%, 100%, 0.9);
  background: hsla(0, 0%, 100%, 0.06);
  border-left: 3px solid #3b82f6;
}
.fb-book__hint {
  font-size: 12px;
  color: #94a3b8;
  padding: 4px 2px;
}
.fb-book__hint.err {
  color: #f56c6c;
}
</style>
