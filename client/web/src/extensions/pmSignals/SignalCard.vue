<script setup lang="ts">
import type { OddsSignal } from "./presentation";
import { signalAge, signedPercent } from "./presentation";

defineProps<{ signal: OddsSignal; now: number }>();
defineEmits<{ locate: [matchId: number] }>();
</script>

<template>
  <article class="odds-signal" :data-signal-id="signal.id" :class="`is-${signal.direction}`">
    <header class="odds-signal__heading">
      <span class="odds-signal__kind"><span class="odds-signal__arrow" aria-hidden="true">{{ signal.direction === 'down' ? '↓' : '↑' }}</span>{{ signal.direction === 'down' ? ' 降赔 · 同向比价' : ' 涨赔 · 对侧套利' }}</span>
      <time :datetime="new Date(signal.detectedAt).toISOString()" :title="new Date(signal.detectedAt).toLocaleString('zh-CN')">{{ signalAge(signal.detectedAt, now) }} · 快照</time>
    </header>
    <div class="odds-signal__match">
      <strong>{{ signal.matchTitle }}</strong>
      <span>{{ signal.marketTitle }}</span>
      <button v-if="signal.matchId !== null" type="button" @click="$emit('locate', signal.matchId)">定位比赛 ↗</button>
    </div>
    <div class="odds-signal__movement">
      <div class="odds-signal__selection"><b>{{ signal.venue }}</b><strong>{{ signal.sideLabel }}</strong></div>
      <div class="odds-signal__prices"><span>{{ signal.beforeOdds.toFixed(3) }}</span><span aria-hidden="true">→</span><b>{{ signal.currentOdds.toFixed(3) }}</b></div>
      <b class="odds-signal__change"><span class="odds-signal__arrow" aria-hidden="true">{{ signal.direction === 'down' ? '↓' : '↑' }}</span> {{ signal.changePct.toFixed(2) }}%</b>
    </div>
    <div v-if="signal.quotes[0]" class="odds-signal__opportunity">
      <div class="odds-signal__target">
        <small>{{ signal.direction === 'down' ? '同方向最高报价' : '另一侧搭配' }}</small>
        <div><b>{{ signal.quotes[0].venue }}</b><strong>{{ signal.quotes[0].sideLabel }}</strong><span>@ {{ signal.quotes[0].odds.toFixed(3) }}</span></div>
      </div>
      <div class="odds-signal__metric" :class="{ 'is-positive': signal.quotes[0].percent > 0 }">
        <small>{{ signal.direction === 'down' ? '同向价差' : '理论套利' }}</small>
        <b>{{ signedPercent(signal.quotes[0].percent) }}</b>
      </div>
    </div>
    <p v-else class="odds-signal__missing">触发时无其他场馆可用报价</p>
    <details class="odds-signal__details">
      <summary>报价详情 <span>{{ (signal.windowMs / 1000).toFixed(2) }}秒内 · {{ signal.sourceLabel }}</span></summary>
      <p>{{ signal.direction === 'down' ? '同向价差 = 其他场馆同侧赔率 ÷ 触发基准赔率 − 1。' : '理论套利按触发时两侧报价计算，未核验可成交深度。' }}</p>
      <table v-if="signal.quotes.length" :aria-label="signal.direction === 'down' ? '触发时同方向报价' : '触发时双边报价'">
        <thead><tr><th>场馆 / 方向</th><th>赔率</th><th>{{ signal.direction === 'down' ? '同向价差' : '理论套利' }}</th></tr></thead>
        <tbody>
          <tr><td>{{ signal.venue }} · {{ signal.sideLabel }}</td><td>{{ signal.currentOdds.toFixed(3) }}</td><td>{{ signal.direction === 'down' ? '基准' : '触发侧' }}</td></tr>
          <tr v-for="quote in signal.quotes" :key="quote.venue"><td>{{ quote.venue }} · {{ quote.sideLabel }}</td><td>{{ quote.odds.toFixed(3) }}</td><td>{{ signedPercent(quote.percent) }}</td></tr>
        </tbody>
      </table>
    </details>
  </article>
</template>

<style scoped>
.odds-signal { --signal-accent: var(--el-color-warning, #e6a23c); min-width: 0; padding: 12px; border: 1px solid var(--el-border-color, #39465a); border-left: 3px solid var(--signal-accent); border-radius: 8px; background: var(--el-bg-color, #18212b); color: var(--el-text-color-primary, #e7edf7); font: 12px/1.5 system-ui, sans-serif; font-variant-numeric: tabular-nums; }
.odds-signal.is-up { --signal-accent: var(--el-color-primary, #409eff); }
.odds-signal__heading, .odds-signal__selection, .odds-signal__prices, .odds-signal__target > div { display: flex; align-items: center; gap: 6px; }
.odds-signal__heading { justify-content: space-between; gap: 4px 10px; flex-wrap: wrap; }
.odds-signal__kind { display: inline-flex; align-items: center; gap: 5px; color: var(--signal-accent); font-weight: 600; }
.odds-signal__arrow { display: inline-block; font-size: 20px; font-weight: 900; line-height: 1; vertical-align: middle; }
time, small, .odds-signal__match > span, .odds-signal__prices > span, .odds-signal__details, .odds-signal__missing { color: var(--el-text-color-secondary, #a8b2bf); }
time { font-size: 10px; white-space: nowrap; }
.odds-signal__match { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 8px; margin-top: 9px; }
.odds-signal__match > strong { grid-column: 1 / -1; overflow-wrap: anywhere; font-size: 13px; }
.odds-signal__match > span { overflow-wrap: anywhere; }
.odds-signal button { padding: 0; border: 0; background: transparent; color: var(--el-color-primary, #409eff); cursor: pointer; font: inherit; }
.odds-signal button:focus-visible, summary:focus-visible { outline: 2px solid var(--el-color-primary, #409eff); outline-offset: 2px; }
.odds-signal__movement { display: flex; align-items: center; flex-wrap: wrap; gap: 5px 12px; margin-top: 10px; }
.odds-signal__selection { flex: 1 1 110px; min-width: 0; overflow-wrap: anywhere; }
.odds-signal__selection > b, .odds-signal__target b { flex: none; font-size: 10px; padding: 1px 4px; border: 1px solid var(--el-border-color, #39465a); border-radius: 3px; }
.odds-signal__prices { white-space: nowrap; }
.odds-signal__prices > b { font-size: 17px; }
.odds-signal__change { color: var(--signal-accent); white-space: nowrap; }
.odds-signal__opportunity { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px; margin-top: 10px; padding: 9px; border-radius: 5px; background: var(--el-fill-color-light, #ffffff08); }
.odds-signal__target { min-width: 0; }
.odds-signal__target > div { flex-wrap: wrap; margin-top: 3px; overflow-wrap: anywhere; }
.odds-signal__target > div > span { white-space: nowrap; }
.odds-signal__metric { display: grid; text-align: right; white-space: nowrap; }
.odds-signal__metric > b { font-size: 19px; }
.odds-signal__metric.is-positive > b { color: var(--el-color-success, #67c23a); }
.odds-signal small { font-size: 10px; }
.odds-signal__details { margin-top: 8px; font-size: 11px; }
.odds-signal__details summary { cursor: pointer; }
.odds-signal__details summary > span { margin-left: 8px; font-size: 10px; }
.odds-signal__details p { margin: 8px 0; }
.odds-signal table { width: 100%; border-collapse: collapse; font-size: 11px; }
.odds-signal th, .odds-signal td { padding: 4px 2px; border-bottom: 1px solid var(--el-border-color, #39465a); text-align: right; font-weight: 400; }
.odds-signal th:first-child, .odds-signal td:first-child { text-align: left; overflow-wrap: anywhere; }
.odds-signal__missing { margin: 8px 0 0; font-size: 11px; }
</style>
