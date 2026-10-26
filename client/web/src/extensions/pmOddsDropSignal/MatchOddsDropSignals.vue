<script setup lang="ts">
import type { ViewBet, ViewMatch } from "@/models/match";
import { computed, ref } from "vue";
import { betOddsDropSignals } from "./matchSignals";
import { pmOddsDropSettings, pmOddsDropSignals } from "./runtime";

const props = defineProps<{ match: ViewMatch; bet: ViewBet }>();
const expanded = ref(false);
const signals = computed(() => betOddsDropSignals(props.match, props.bet, pmOddsDropSignals.value));
const visibleSignals = computed(() => expanded.value ? signals.value : signals.value.slice(0, 3));
const comparisonVenues = [
  { key: "pm", venue: "Polymarket", label: "PM" },
  { key: "ob", venue: "OB", label: "OB" },
  { key: "ray", venue: "RAY", label: "RAY" },
  { key: "pb", venue: "PB", label: "PB" },
] as const;

function timeLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("zh-CN", { hour12: false });
}

function evLabel(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}
</script>

<template>
  <section v-if="signals.length" class="match-drop" :aria-label="`${bet.getBetName()}降赔率信号`">
    <div class="match-drop__heading">
      <strong>↓ 降赔信号</strong>
      <span>{{ pmOddsDropSettings.enabled ? '触发时快照' : '监测已关闭' }}</span>
      <button
        v-if="signals.length > 3"
        type="button"
        :aria-expanded="expanded"
        @click="expanded = !expanded"
      >{{ expanded ? '收起' : `展开全部 ${signals.length} 条` }}</button>
    </div>
    <article v-for="{ signal, snapshot } in visibleSignals" :key="signal.id" class="match-drop__signal">
      <div class="match-drop__main">
        <div class="match-drop__summary" :class="{ 'match-drop__summary--away': snapshot.side === 'Away' }">
          <div class="match-drop__identity">
            <b class="match-drop__venue">{{ signal.referenceVenue === 'Polymarket' ? 'PM' : signal.referenceVenue }}</b>
            <strong class="match-drop__side">{{ snapshot.sideLabel }}</strong>
          </div>
          <b class="match-drop__percent">↓ {{ signal.dropPct.toFixed(2) }}%</b>
        </div>
        <span class="match-drop__odds">{{ signal.beforeOdds.toFixed(3) }} → <b>{{ signal.currentOdds.toFixed(3) }}</b></span>
        <div class="match-drop__timing">
          <span>{{ signal.windowMs / 1000 }}秒内</span>
          <time :datetime="new Date(signal.detectedAt).toISOString()" :title="new Date(signal.detectedAt).toLocaleString('zh-CN')">触发于 {{ timeLabel(signal.detectedAt) }}</time>
        </div>
      </div>
      <div class="match-drop__comparison" aria-label="触发时各场馆赔率与EV">
        <template v-for="venue in comparisonVenues" :key="venue.key">
          <span
            v-if="venue.venue !== signal.referenceVenue && snapshot[venue.key]"
            :class="{ 'is-positive': snapshot[venue.key]!.evPercent > 0 }"
          >{{ venue.label }} {{ snapshot[venue.key]!.odds.toFixed(3) }} · EV {{ evLabel(snapshot[venue.key]!.evPercent) }}</span>
        </template>
      </div>
    </article>
  </section>
</template>

<style scoped>
.match-drop {
  margin: 0 0 8px;
  padding: 6px;
  border: 1px solid #e6a23c80;
  border-left: 3px solid #e6a23c;
  border-radius: 6px;
  background: var(--el-bg-color, #18212b);
  color: var(--el-text-color-primary, #e8edf2);
  font-size: 11px;
  line-height: 1.6;
}
.match-drop__heading,
.match-drop__main,
.match-drop__comparison {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 3px 6px;
}
.match-drop__heading { margin-bottom: 4px; }
.match-drop__heading > span,
.match-drop__timing,
time { color: var(--el-text-color-secondary, #a8b2bf); }
.match-drop__heading button {
  margin-left: auto;
  border: 0;
  padding: 2px 4px;
  background: transparent;
  color: var(--el-color-primary, #409eff);
  font: inherit;
  cursor: pointer;
}
.match-drop__signal { padding: 6px 0; }
.match-drop__signal + .match-drop__signal { border-top: 1px solid var(--el-border-color, #ffffff26); }
.match-drop__summary { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 6px; width: 100%; }
.match-drop__identity { display: flex; align-items: center; gap: 6px; min-width: 0; }
.match-drop__summary--away { grid-template-columns: auto minmax(0, 1fr); }
.match-drop__summary--away .match-drop__percent { grid-column: 1; grid-row: 1; }
.match-drop__summary--away .match-drop__identity { grid-column: 2; grid-row: 1; justify-content: flex-end; }
.match-drop__venue { min-width: 22px; }
.match-drop__side { min-width: 0; overflow-wrap: anywhere; }
.match-drop__percent { color: var(--el-color-danger, #f56c6c); white-space: nowrap; }
.match-drop__odds { width: 100%; }
.match-drop__timing { display: flex; flex-wrap: wrap; gap: 0 6px; width: 100%; }
.match-drop__odds,
time { font-variant-numeric: tabular-nums; white-space: nowrap; }
time { margin-left: auto; }
.match-drop__comparison { margin-top: 4px; color: var(--el-text-color-secondary, #a8b2bf); }
.match-drop__comparison > span { white-space: nowrap; }
.match-drop__comparison .is-positive { color: var(--el-color-success, #67c23a); }
</style>
