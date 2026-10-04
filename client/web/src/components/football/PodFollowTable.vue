<script setup lang="ts" generic="T extends PodFollowTableRow">
import { computed } from "vue";
import { formatPodAgo, formatPodDropPct, formatPodPrice } from "@/runtime/podAlerts";
import { formatPodFixtureMatch } from "@/runtime/podFixtureMatch";
import { formatPodMarketMatch } from "@/runtime/podMarketMatch";
import { formatPodEv } from "@/runtime/podYabo/ev";
import { formatPodTableDate, podFollowTableValues, type PodFollowTableRow } from "@/runtime/podFollowTableRow";

const props = defineProps<{
  rows: T[];
  now: number;
  plannedStakes: string;
  selectedAccounts: string;
  showDiagnostics: boolean;
  emptyText: string;
}>();
const emit = defineEmits<{ locate: [row: T] }>();
defineSlots<{ actions(props: { row: T }): unknown; diagnostics(props: { row: T }): unknown; venueNotes(props: { row: T }): unknown }>();
const entries = computed(() => props.rows.map(row => ({ row, values: podFollowTableValues(row) })));
</script>

<template>
  <table class="pod-follow-table" aria-label="POD 跟单明细">
    <colgroup>
      <col class="col-number"><col class="col-match"><col class="col-league"><col class="col-time">
      <col class="col-market"><col class="col-match-state"><col class="col-price"><col class="col-price">
      <col class="col-price"><col class="col-price"><col class="col-price"><col class="col-price">
      <col class="col-range"><col class="col-stake"><col class="col-account"><col class="col-status"><col class="col-actions">
    </colgroup>
    <thead>
      <tr>
        <th scope="col" class="frozen-number">#</th>
        <th scope="col" class="frozen-match">比赛</th>
        <th scope="col">联赛</th><th scope="col">开赛 / 警报时间</th>
        <th scope="col">盘口 / 投注方向</th><th scope="col">赛事 / 盘口匹配</th>
        <th scope="col" class="numeric">降幅</th>
        <th scope="col" class="numeric">PIN 原赔</th><th scope="col" class="numeric">PIN 现赔</th>
        <th scope="col" class="numeric">NVP</th><th scope="col" class="numeric">OB 报价</th>
        <th scope="col" class="numeric">EV</th><th scope="col">可接受赔率</th>
        <th scope="col">注额</th><th scope="col">账号 / 回执</th><th scope="col">执行状态 / 原因</th><th scope="col">操作</th>
      </tr>
    </thead>
    <tbody>
      <tr v-if="!entries.length"><td colspan="17" class="empty">{{ emptyText }}</td></tr>
      <tr v-for="({ row, values }, index) in entries" :key="row.log.id" class="data-row"
        :class="{ 'is-placed': row.pending.placed, 'is-ready': row.pending.tone === 'ready' }">
        <td class="frozen-number numeric">{{ index + 1 }}</td>
        <td class="frozen-match">
          <button type="button" class="match-link" :disabled="!values.obMid" @click="emit('locate', row)">
            <span>{{ values.home }}</span><span class="versus">vs</span><span>{{ values.away }}</span>
          </button>
          <span class="secondary">OB {{ values.obMid || '—' }}</span>
        </td>
        <td>{{ values.league || '—' }}</td>
        <td>
          <span>{{ formatPodTableDate(values.starts) }}</span>
          <span class="secondary">{{ row.live ? '警报' : '记录' }} {{ formatPodTableDate(values.at) }}</span>
          <span class="secondary">{{ formatPodAgo(values.at, now) }}</span>
        </td>
        <td><span>{{ values.market || '—' }}</span><strong class="selection">{{ values.side || '—' }}</strong></td>
        <td>
          <template v-if="row.live">
            <span>{{ formatPodFixtureMatch(row.live.fixtureMatch) }}</span>
            <span class="secondary">{{ formatPodMarketMatch(row.live.marketMatch) }}</span>
          </template>
          <template v-else><span>历史记录</span><span class="secondary">当前盘口已离线</span></template>
          <details class="details" @click.stop>
            <summary>盘口 ID / 详情</summary>
            <span class="secondary">oid {{ values.oid || '—' }}</span>
            <template v-if="row.live">
              <span v-if="row.live.pmFixtureMatch.status === 'matched'" class="secondary">
                PM · {{ formatPodMarketMatch(row.live.pmMarketMatch) }} · @{{ formatPodPrice(row.live.pmQuote.quote) }} · {{ formatPodEv(row.live.pmQuote.evPercent) }}
              </span>
              <span v-if="row.live.rayFixtureMatch.status === 'matched'" class="secondary">
                RAY · {{ formatPodMarketMatch(row.live.rayMarketMatch) }} · @{{ formatPodPrice(row.live.rayQuote.quote) }} · {{ formatPodEv(row.live.rayQuote.evPercent) }}
              </span>
            </template>
          </details>
        </td>
        <td class="numeric positive">{{ formatPodDropPct(values.dropPct) }}</td>
        <td class="numeric">{{ formatPodPrice(values.pinPrevious) }}</td>
        <td class="numeric">{{ formatPodPrice(values.pinCurrent) }}</td>
        <td class="numeric">{{ formatPodPrice(values.nvp) }}</td>
        <td class="numeric" :class="{ positive: row.pending.placed || values.quoteStatus === 'ok' }">
          {{ formatPodPrice(values.quote) }}
          <span class="secondary">{{ row.pending.placed ? '下单快照' : !row.live ? '历史快照' : values.quoteStatus === 'locked' ? '锁盘' : values.quoteStatus === 'short' ? '低于门槛' : values.quoteStatus === 'spike' ? 'EV异常' : values.quoteStatus === 'none' ? '缺价' : '当前报价' }}</span>
        </td>
        <td class="numeric" :class="{ positive: values.ev > 0, negative: values.ev < 0 }">{{ formatPodEv(values.ev) }}</td>
        <td>≥ {{ formatPodPrice(values.minOdds) }}<span v-if="values.maxOdds > 0" class="secondary">≤ {{ formatPodPrice(values.maxOdds) }}</span></td>
        <td>
          <template v-if="row.pending.placed">{{ row.log.stake > 0 ? row.log.stake : '—' }}<span class="secondary">已下记录</span></template>
          <template v-else>{{ plannedStakes || '未设' }}<span class="secondary">计划注额</span></template>
        </td>
        <td>
          {{ values.accounts || (row.pending.placed ? '回执未记录' : selectedAccounts || '未选择账号') }}
          <span v-if="row.pending.receipt" class="secondary">{{ row.pending.receipt.clock }} · {{ row.pending.receipt.ago }}</span>
        </td>
        <td class="execution">
          <span class="status" :class="`is-${row.pending.tone}`">{{ row.pending.label }}</span>
          <span v-if="!row.pending.placed && row.pending.detail" class="status-detail">{{ row.pending.detail }}</span>
          <slot name="venueNotes" :row="row" />
          <slot v-if="showDiagnostics && row.live" name="diagnostics" :row="row" />
        </td>
        <td><div class="actions"><slot name="actions" :row="row" /></div><span v-if="!row.live" class="secondary">历史记录</span></td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
.pod-follow-table { width: 2200px; table-layout: fixed; border-collapse: separate; border-spacing: 0; font-size: 12px; line-height: 1.5; user-select: text; }
.col-number { width: 40px; }.col-match { width: 230px; }.col-league { width: 150px; }.col-time { width: 145px; }
.col-market { width: 180px; }.col-match-state { width: 235px; }.col-price { width: 85px; }.col-range { width: 115px; }
.col-stake { width: 135px; }.col-account { width: 185px; }.col-status { width: 245px; }.col-actions { width: 125px; }
th, td { padding: 9px 10px; border-right: 1px solid #334155; border-bottom: 1px solid #334155; vertical-align: top; overflow-wrap: anywhere; }
th { position: sticky; top: 0; z-index: 3; background: #1e293b; color: #cbd5e1; font-weight: 600; text-align: left; white-space: nowrap; }
td { background: #111827; color: #e2e8f0; }
.data-row:nth-child(even) td { background: #172033; }.data-row.is-placed td { background: #122b25; }.data-row:hover td { background: #25334b; }
.frozen-number { position: sticky; left: 0; z-index: 2; }.frozen-match { position: sticky; left: 40px; z-index: 2; box-shadow: 3px 0 5px #0003; }
th.frozen-number, th.frozen-match { z-index: 4; }
.numeric { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.secondary { display: block; margin-top: 3px; color: #94a3b8; font-size: 11px; white-space: normal; }
.positive { color: #86efac; }.negative { color: #fca5a5; }.selection { display: block; margin-top: 4px; color: #fde68a; font-weight: 600; }
.match-link { display: block; padding: 0; border: 0; background: transparent; color: #f8fafc; text-align: left; font: inherit; font-weight: 600; cursor: pointer; user-select: text; }
.match-link span { display: block; }.match-link .versus { font-size: 10px; color: #64748b; font-weight: 400; }
.match-link:hover { color: #93c5fd; }.match-link:disabled { cursor: default; color: #cbd5e1; }
.status { display: inline-block; padding: 2px 7px; border-radius: 4px; font-weight: 600; background: #334155; }
.status.is-ok { color: #86efac; background: #14532d; }.status.is-ready { color: #fde68a; background: #713f12; }
.status.is-block { color: #fdba74; background: #7c2d12; }.status.is-wait { color: #7dd3fc; background: #0c4a6e; }.status.is-idle { color: #cbd5e1; }
.status-detail { display: block; margin-top: 6px; color: #fdba74; white-space: normal; overflow-wrap: anywhere; }
.actions { display: flex; flex-wrap: wrap; gap: 5px; }.details { margin-top: 6px; }.details summary { color: #93c5fd; cursor: pointer; font-size: 11px; }
.empty { padding: 24px; color: #94a3b8; text-align: left; }
</style>
