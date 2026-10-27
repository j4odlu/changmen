<script setup lang="ts">
import type { PmUpSignal } from "./detector";

defineProps<{ signals: readonly PmUpSignal[]; showMatch?: boolean }>();

function timeLabel(at: number): string {
  return new Date(at).toLocaleTimeString("zh-CN", { hour12: false });
}
</script>

<template>
  <div class="pm-up-signals">
    <article v-for="signal in signals" :key="signal.id" class="pm-up-signal">
      <div class="pm-up-signal__summary" :class="{ 'is-away': signal.pmSide === 'Away' }">
        <strong>PM · {{ signal.pmSideLabel }}</strong>
        <b>↑ {{ signal.risePct.toFixed(2) }}%</b>
      </div>
      <div v-if="showMatch" class="pm-up-signal__match">
        <strong>{{ signal.matchTitle }}</strong>
        <span>{{ signal.marketTitle }}</span>
      </div>
      <div class="pm-up-signal__odds">
        PM {{ signal.pmSideLabel }} {{ signal.beforeOdds.toFixed(3) }} → <b>{{ signal.pmOdds.toFixed(3) }}</b>
      </div>
      <div class="pm-up-signal__target" aria-label="触发时对侧场馆赔率与套利空间">
        <strong>关注 {{ signal.target.provider }} · {{ signal.targetSideLabel }} @{{ signal.target.odds.toFixed(3) }}</strong>
        <b>套利 +{{ signal.arbPct.toFixed(2) }}%</b>
      </div>
      <div class="pm-up-signal__detail">
        <span>{{ ((signal.detectedAt - signal.baselineAt) / 1000).toFixed(2) }} 秒内</span>
        <time :datetime="new Date(signal.detectedAt).toISOString()" :title="new Date(signal.detectedAt).toLocaleString('zh-CN')">{{ timeLabel(signal.detectedAt) }} 触发快照</time>
      </div>
    </article>
  </div>
</template>

<style scoped>
.pm-up-signals { display: grid; gap: 6px; min-width: 0; }
.pm-up-signal { padding: 6px 0; color: var(--paper-ink, var(--brutal-ink, var(--term-ink, #e7edf7))); font-size: 11px; line-height: 1.6; }
.pm-up-signal + .pm-up-signal { border-top: 1px solid color-mix(in srgb, var(--cm-color-muted, #94a3b8) 25%, transparent); }
.pm-up-signal__summary { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.pm-up-signal__summary.is-away { flex-direction: row-reverse; }
.pm-up-signal__summary > b, .pm-up-signal__target { color: var(--cm-color-success, #67c23a); }
.pm-up-signal__match { display: grid; gap: 2px; margin: 4px 0; overflow-wrap: anywhere; }
.pm-up-signal__match > span, .pm-up-signal__detail { color: var(--cm-color-muted, #94a3b8); }
.pm-up-signal__odds { margin-top: 3px; font-variant-numeric: tabular-nums; }
.pm-up-signal__target, .pm-up-signal__detail { display: flex; align-items: center; gap: 3px 8px; flex-wrap: wrap; }
.pm-up-signal__target { margin-top: 4px; }
.pm-up-signal__detail { margin-top: 4px; font-variant-numeric: tabular-nums; }
.pm-up-signal__detail time { margin-left: auto; }
</style>
