<script setup lang="ts">
import type { BetProgressStage } from "@/shared/activeBetRunStages";

/** [changmen 扩展] 常驻关键阶段，不受详细时间线的最近条数限制。 */
defineProps<{ stages: readonly BetProgressStage[] }>();
function eventTime(at: number) {
  return new Date(at).toLocaleTimeString("zh-CN", { hour12: false });
}
</script>

<template>
  <section class="active-bet-run__stages" aria-label="编排关键阶段">
    <strong class="active-bet-run__stages-heading">关键阶段</strong>
    <ol>
      <li v-for="item in stages" :key="item.id" :data-stage="item.id" :data-tone="item.tone">
        <span class="active-bet-run__stage-name">{{ item.stage }}</span>
        <div class="active-bet-run__stage-content">
          <div class="active-bet-run__stage-heading">
            <strong>{{ item.label }}</strong>
            <time v-if="item.at !== undefined">{{ eventTime(item.at) }}</time>
            <small v-if="item.durationMs !== undefined">{{ item.durationMs }}ms</small>
          </div>
          <p v-if="item.detail">{{ item.detail }}</p>
        </div>
      </li>
    </ol>
  </section>
</template>
