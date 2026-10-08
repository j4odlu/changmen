<script setup lang="ts">
import type { OrderObservationEvent } from "@changmen/shared/order_observation";
import type { ActiveBetLeg, ActiveBetRun } from "@/types/activeBetRun";
import type { OrderRow } from "@/types/order";
import { computed } from "vue";
import { activeBetRunComparison } from "@/shared/activeBetRunComparison";
import { activeBetLegRole } from "@/shared/activeBetRunPresentation";

/** [changmen 扩展] 原生表格共享行高，错误说明换行时双腿仍按阶段对齐。 */
const props = defineProps<{ run: ActiveBetRun; facts: ReadonlyMap<ActiveBetLeg["side"], readonly OrderObservationEvent[]>; orders?: readonly OrderRow[]; executionEvents?: readonly OrderObservationEvent[] }>();
const legs = computed(() => [...props.run.legs].sort((a, b) => a.side.localeCompare(b.side)));
const groups = computed(() => activeBetRunComparison(props.run, props.facts, props.orders, props.executionEvents));
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
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
