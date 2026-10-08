<script setup lang="ts" generic="T extends PodFollowTableRow">
import { computed } from "vue";
import { formatPodAgo, formatPodDropPct, formatPodPrice } from "@/runtime/podAlerts";
import { formatPodEv } from "@/runtime/podYabo/ev";
import { formatPodTableDate, podFollowTableValues, podFollowTableVenues, type PodFollowTableRow } from "@/runtime/podFollowTableRow";

const props = defineProps<{
  rows: T[];
  now: number;
  showDiagnostics: boolean;
  emptyText: string;
}>();
const emit = defineEmits<{ locate: [row: T] }>();
defineSlots<{ actions(props: { row: T }): unknown; diagnostics(props: { row: T }): unknown }>();
const entries = computed(() => props.rows.map(row => ({ row, values: podFollowTableValues(row), quotes: podFollowTableVenues(row) })));
</script>

<template>
  <table class="pod-follow-table" aria-label="POD 跟单明细">
    <colgroup>
      <col class="col-match"><col class="col-market"><col class="col-pin"><col class="col-quote">
      <col class="col-account"><col class="col-status"><col class="col-actions">
    </colgroup>
    <thead>
      <tr>
        <th scope="col" class="frozen-match">比赛 / 时间</th>
        <th scope="col">盘口 / 匹配</th>
        <th scope="col" class="numeric">PIN / 降幅</th>
        <th scope="col" class="numeric">场馆报价 / EV</th>
        <th scope="col">账号 / 注额</th>
        <th scope="col">执行状态</th>
        <th scope="col">操作</th>
      </tr>
    </thead>
    <tbody>
      <tr v-if="!entries.length"><td colspan="7" class="empty">{{ emptyText }}</td></tr>
      <tr v-for="({ row, values, quotes }, index) in entries" :key="row.log.id" class="data-row"
        :class="{ 'is-placed': quotes.some(venue => venue.submitted), 'is-ready': quotes.some(venue => venue.stateTone === 'ready') }">
        <td class="frozen-match">
          <button type="button" class="match-link" :disabled="!quotes.some(venue => venue.matchId || venue.fixtureId)" @click="emit('locate', row)">
            <span class="row-number">{{ index + 1 }}.</span> {{ values.home }} <span class="versus">vs</span> {{ values.away }}
          </button>
          <span class="secondary">{{ values.league || '—' }}</span>
          <span class="secondary">开赛 {{ formatPodTableDate(values.starts) }} · {{ formatPodAgo(values.at, now) }}</span>
          <details class="details" @click.stop>
            <summary>时间 / 比赛 ID</summary>
            <span class="secondary">{{ row.live ? '警报' : '记录' }} {{ formatPodTableDate(values.at) }}</span>
            <span v-for="venue in quotes" :key="venue.venue" class="secondary">{{ venue.label }} {{ venue.matchId || '—' }}</span>
          </details>
        </td>
        <td>
          <strong class="selection">{{ values.side || '—' }}</strong>
          <span class="secondary">{{ values.market || '—' }}</span>
          <span v-for="venue in quotes" :key="venue.venue" class="secondary">{{ venue.label }} · {{ venue.marketText }}</span>
          <details class="details" @click.stop>
            <summary>匹配详情</summary>
            <div v-for="venue in quotes" :key="venue.venue">
              <span class="secondary">{{ venue.label }} · {{ venue.fixtureText }}</span>
              <span class="secondary">oid {{ venue.oid || '—' }}</span>
            </div>
          </details>
        </td>
        <td class="numeric">
          <span>{{ formatPodPrice(values.pinPrevious) }} → {{ formatPodPrice(values.pinCurrent) }}</span>
          <span class="secondary positive">降 {{ formatPodDropPct(values.dropPct) }}</span>
        </td>
        <td class="numeric">
          <div v-for="quote in quotes" :key="quote.venue" class="venue-quote">
            <strong :class="{ positive: quote.snapshot || quote.status === 'ok' }">{{ quote.label }} @{{ formatPodPrice(quote.quote) }}</strong>
            <span class="secondary" :class="{ positive: quote.ev > 0, negative: quote.ev < 0 }">{{ formatPodEv(quote.ev) }}</span>
            <span class="secondary">{{ quote.snapshot ? '提交参考' : quote.historical ? '历史参考' : quote.status === 'locked' ? '锁盘' : quote.status === 'short' ? '低于门槛' : quote.status === 'spike' ? 'EV异常' : quote.status === 'none' ? '缺价' : '当前报价' }}</span>
          </div>
          <span v-if="!quotes.length" class="secondary">暂无场馆报价</span>
          <details class="details" @click.stop>
            <summary>NVP / 赔率范围</summary>
            <div v-for="quote in quotes" :key="quote.venue">
              <span class="secondary">{{ quote.venue }} · NVP {{ formatPodPrice(quote.nvp) }}</span>
              <span class="secondary">≥ {{ formatPodPrice(quote.minOdds) }}<template v-if="quote.maxOdds > 0"> · ≤ {{ formatPodPrice(quote.maxOdds) }}</template></span>
            </div>
          </details>
        </td>
        <td>
          <div v-for="venue in quotes" :key="venue.venue" class="venue-quote">
            <strong>{{ venue.label }}</strong>
            <span class="secondary">{{ venue.submitted ? '回执见执行状态' : venue.historical ? '账号未记录' : venue.accountIds.length ? venue.accountIds.map(id => '#' + id).join('、') : '未选择账号' }}</span>
            <span v-if="!venue.submitted && !venue.historical" class="secondary" title="配置金额；自动跟单策略可能调整，实际金额以订单为准">配置单注 {{ venue.plannedStake || '未设' }}</span>
            <span v-else class="secondary">实际注额见订单</span>
          </div>
        </td>
        <td class="execution">
          <div v-for="venue in quotes" :key="venue.venue" class="venue-quote">
            <span class="status" :class="`is-${venue.stateTone}`">{{ venue.label }} · {{ venue.stateLabel }}</span>
            <span v-if="venue.stateDetail" class="status-detail">{{ venue.stateDetail }}</span>
            <span v-if="venue.submittedAt" class="secondary">回执记录 {{ formatPodTableDate(venue.submittedAt) }}</span>
          </div>
          <slot v-if="showDiagnostics && row.live" name="diagnostics" :row="row" />
        </td>
        <td><div class="actions"><slot name="actions" :row="row" /></div><span v-if="!row.live" class="secondary">历史记录</span></td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
.pod-follow-table { width: 100%; min-width: 1055px; table-layout: fixed; border-collapse: separate; border-spacing: 0; font-size: 12px; line-height: 1.5; user-select: text; }
.col-match { width: 200px; }.col-market { width: 165px; }.col-pin { width: 135px; }.col-quote { width: 130px; }
.col-account { width: 145px; }.col-status { width: 180px; }.col-actions { width: 100px; }
th, td { padding: 9px 10px; border-right: 1px solid #334155; border-bottom: 1px solid #334155; vertical-align: top; overflow-wrap: anywhere; }
th { position: sticky; top: 0; z-index: 3; background: #1e293b; color: #cbd5e1; font-weight: 600; text-align: left; white-space: nowrap; }
td { background: #111827; color: #e2e8f0; }
.data-row:nth-child(even) td { background: #172033; }.data-row.is-placed td { background: #122b25; }.data-row:hover td { background: #25334b; }
.frozen-match { position: sticky; left: 0; z-index: 2; box-shadow: 3px 0 5px #0003; }
th.frozen-match { z-index: 4; }
.numeric { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.secondary { display: block; margin-top: 3px; color: #94a3b8; font-size: 11px; white-space: normal; }
.positive { color: #86efac; }.negative { color: #fca5a5; }.selection { display: block; margin-top: 4px; color: #fde68a; font-weight: 600; }
.match-link { display: block; padding: 0; border: 0; background: transparent; color: #f8fafc; text-align: left; font: inherit; font-weight: 600; cursor: pointer; user-select: text; }
.row-number { color: #64748b; font-size: 11px; font-weight: 400; }.match-link .versus { font-size: 10px; color: #64748b; font-weight: 400; }
.match-link:hover { color: #93c5fd; }.match-link:disabled { cursor: default; color: #cbd5e1; }
.status { display: inline-block; padding: 2px 7px; border-radius: 4px; font-weight: 600; background: #334155; }
.status.is-ok { color: #86efac; background: #14532d; }.status.is-ready { color: #fde68a; background: #713f12; }
.status.is-block { color: #fdba74; background: #7c2d12; }.status.is-wait { color: #7dd3fc; background: #0c4a6e; }.status.is-idle { color: #cbd5e1; }
.status-detail { display: block; margin-top: 6px; color: #fdba74; white-space: normal; overflow-wrap: anywhere; }
.actions { display: flex; flex-wrap: wrap; gap: 5px; }.details { margin-top: 6px; }.details summary { color: #93c5fd; cursor: pointer; font-size: 11px; }
.empty { padding: 24px; color: #94a3b8; text-align: left; }
.venue-quote + .venue-quote { margin-top: 7px; padding-top: 6px; border-top: 1px solid #334155; }
</style>
