<script setup lang="ts">
import type { OrderObservationEvent } from "@changmen/shared/order_observation";
import { observationEventLabel, observationEventStage } from "@changmen/shared/order_observation_view";
import { computed, nextTick, onMounted, ref, watch } from "vue";

/** [changmen 扩展] 每个方向独立滚动，仅消费同源执行事件。 */
const props = defineProps<{
  title: string;
  subtitle?: string;
  events: readonly OrderObservationEvent[];
  startedAt: number;
  expanded: boolean;
}>();
const feedEl = ref<HTMLElement | null>(null);
const following = ref(true);
const displayed = computed(() => props.expanded ? props.events : props.events.slice(-6));

function scrollToLatest() {
  if (following.value && feedEl.value)
    feedEl.value.scrollTop = feedEl.value.scrollHeight;
}
function onScroll() {
  const el = feedEl.value;
  if (el)
    following.value = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
}
function eventTime(at: number) {
  return new Date(at).toLocaleTimeString("zh-CN", { hour12: false });
}
function elapsed(event: OrderObservationEvent) {
  const ms = event.occurredAt - props.startedAt;
  return ms < 0 ? "时钟偏差" : ms < 1000 ? `+${ms}ms` : `+${(ms / 1000).toFixed(1)}s`;
}
function identity(event: OrderObservationEvent) {
  return `执行 ${event.executionId || "—"} · 尝试 ${event.attemptId || "—"} · 队列 ${event.queueId || "—"} · 事件 ${event.eventId}`;
}
onMounted(() => { void nextTick(scrollToLatest); });
watch(displayed, () => { void nextTick(scrollToLatest); });
</script>

<template>
  <section class="active-bet-run__timeline-group" :aria-label="`${title}执行时间线`">
    <header class="active-bet-run__timeline-group-head">
      <strong>{{ title }}</strong>
      <small>{{ subtitle }} · {{ events.length }} 条</small>
    </header>
    <p v-if="!events.length" class="active-bet-run__record-empty">
      尚无此方向的执行记录
    </p>
    <ol v-else ref="feedEl" class="active-bet-run__timeline-feed" @scroll="onScroll">
      <li v-for="event in displayed" :key="event.eventId" :title="identity(event)">
        <div class="active-bet-run__event-top">
          <time>{{ eventTime(event.occurredAt) }}</time>
          <span>{{ observationEventStage(event) }}</span>
          <strong>{{ event.provider === 'Polymarket' ? 'PM' : event.provider || '系统' }}</strong>
          <small>{{ elapsed(event) }}</small>
        </div>
        <p>{{ observationEventLabel(event) }}</p>
        <small v-if="event.orderId || event.accountId" class="active-bet-run__event-ref">
          {{ event.accountId ? `账号 #${event.accountId}` : '' }} {{ event.orderId ? `订单 ${event.orderId}` : '' }}
        </small>
      </li>
    </ol>
  </section>
</template>
