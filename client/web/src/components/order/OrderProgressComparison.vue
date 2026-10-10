<script setup lang="ts">
import type { OrderObservationEvent } from "@changmen/shared/order_observation";
import type { ActiveBetLeg, ActiveBetRun } from "@/types/activeBetRun";
import type { OrderRow } from "@/types/order";
import type { BetProgressStage } from "@/shared/activeBetRunStages";
import { computed, ref } from "vue";
import OrderExecutionTimeline from "./OrderExecutionTimeline.vue";
import { activeBetRunComparison } from "@/shared/activeBetRunComparison";
import { activeBetRunComparisonTimeline } from "@/shared/activeBetRunComparisonTimeline";
import { activeBetLegRole } from "@/shared/activeBetRunPresentation";
import { activeBetLegAttemptViews } from "@/shared/activeBetRunStages";

/** [changmen 扩展] 原生表格共享行高，错误说明换行时双腿仍按阶段对齐。 */
const props = defineProps<{
  run: ActiveBetRun;
  facts: ReadonlyMap<ActiveBetLeg["side"], readonly OrderObservationEvent[]>;
  orders?: readonly OrderRow[];
  executionEvents?: readonly OrderObservationEvent[];
  currentStages?: ReadonlyMap<ActiveBetLeg["side"], BetProgressStage[]>;
  expandedTimeline?: boolean;
  accountName?: (event: OrderObservationEvent) => string;
}>();
const legs = computed(() => [...props.run.legs].sort((a, b) => a.side.localeCompare(b.side)));
const groups = computed(() => activeBetRunComparison(props.run, props.facts, props.orders, props.executionEvents, props.currentStages));
const timelines = computed(() => activeBetRunComparisonTimeline(props.run, props.facts, groups.value));
const attemptLabels = computed(() => new Map(legs.value.map(leg => [leg.side, new Map(
  activeBetLegAttemptViews(props.run, leg, props.facts.get(leg.side) || []).attempts.map(attempt => [attempt.id, attempt.label]),
)])));
const openTimelines = ref<Record<string, boolean>>({});
function timelineKey(group: string, stage: string, index: number) { return `${group}/${stage}/${legs.value[index]!.side}`; }
function onTimelineToggle(group: string, stage: string, index: number, event: Event) {
  openTimelines.value[timelineKey(group, stage, index)] = (event.target as HTMLDetailsElement).open;
}
function timelineAccountName(event: OrderObservationEvent) { return props.accountName?.(event) || "名称不可用"; }
function stageEvents(group: string, stage: string, index: number) {
  return timelines.value.get(group)?.get(stage)?.get(legs.value[index]!.side) || [];
}
function eventTime(at: number) { return new Date(at).toLocaleTimeString("zh-CN", { hour12: false }); }
</script>

<template>
  <div class="active-bet-run__comparison-scroll">
    <table class="active-bet-run__comparison" aria-label="双腿各阶段结果对照">
      <thead>
        <tr>
          <th scope="col" class="active-bet-run__comparison-phase">阶段</th>
          <th v-for="leg in legs" :key="leg.side" scope="col">
            <strong>{{ leg.side }}腿 · {{ leg.platform === 'Polymarket' ? 'PM' : leg.platform }} · {{ leg.target === 'Home' ? '主队' : '客队' }}</strong>
            <small>{{ activeBetLegRole(leg) }}</small>
            <slot name="leg-summary" :leg="leg" />
          </th>
        </tr>
      </thead>
      <tbody v-for="group in groups" :key="group.key" :data-attempt="group.key">
        <tr class="active-bet-run__comparison-group">
          <th :colspan="legs.length + 1" scope="rowgroup">
            {{ group.label }}
            <small v-for="(provider, index) in group.providers" :key="index">{{ provider ? `${legs[index]?.side}腿 ${provider}` : '' }}</small>
          </th>
        </tr>
        <tr v-for="row in group.rows" :key="row.id" :data-stage="row.id">
          <th scope="row">{{ row.stage }}</th>
          <td v-for="(cell, index) in row.cells" :key="index" :data-side="legs[index]?.side" :data-tone="cell.tone">
            <div class="active-bet-run__comparison-result">
              <strong>{{ cell.label }}</strong>
              <span v-if="cell.odds !== undefined" class="active-bet-run__precheck-odds">预检赔率 @{{ cell.odds }}</span>
              <time v-if="cell.at !== undefined">{{ eventTime(cell.at) }}</time>
              <small v-if="cell.durationMs !== undefined">{{ cell.durationMs }}ms</small>
            </div>
            <p v-if="cell.detail">{{ cell.detail }}</p>
            <details v-if="stageEvents(group.key, row.id, index).length" class="active-bet-run__comparison-events" :open="expandedTimeline" @toggle="onTimelineToggle(group.key, row.id, index, $event)">
              <summary>执行时间线 · {{ stageEvents(group.key, row.id, index).length }} 条</summary>
              <OrderExecutionTimeline
                compact :title="`${legs[index]!.side}腿 · ${row.stage}`" :events="stageEvents(group.key, row.id, index)"
                :started-at="run.startedAt" :expanded="Boolean(expandedTimeline)" :account-name="timelineAccountName"
                :visible="openTimelines[timelineKey(group.key, row.id, index)] ?? Boolean(expandedTimeline)"
                :attempt-labels="group.key === 'current' || row.id === 'result' || row.id === 'makeup' ? attemptLabels.get(legs[index]!.side) : undefined"
              />
              <small v-if="!expandedTimeline && stageEvents(group.key, row.id, index).length > 6">显示最近 6 条，可展开全部记录</small>
            </details>
            <details v-else-if="row.id === 'result' && !facts.get(legs[index]!.side)?.length && legs[index]!.events.length" class="active-bet-run__comparison-events">
              <summary>编排记录 · {{ legs[index]!.events.length }} 条</summary>
              <ul class="active-bet-run__fallback-feed">
                <li v-for="(event, eventIndex) in legs[index]!.events" :key="eventIndex">
                  <time>{{ eventTime(event.at) }}</time><span>{{ event.stage }}</span><p>编排记录 · {{ event.detail }}</p>
                </li>
              </ul>
            </details>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
