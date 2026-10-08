<script setup lang="ts">
import type { OrderObservationEvent } from "@changmen/shared/order_observation";
import { observationEventLabel, observationEventStage } from "@changmen/shared/order_observation_view";
import { adminObservationSource } from "@/shared/adminOrderObservation";
defineProps<{ event: Readonly<OrderObservationEvent> }>();
function time(at?: number) { return at ? new Date(at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "未记录"; }
</script>

<template>
  <div class="observation-event">
    <p>{{ observationEventStage(event) }} · {{ observationEventLabel(event) }}</p>
    <p v-if="event.odds !== undefined || event.amount !== undefined || event.planAmount !== undefined || event.exchange !== undefined || event.rate !== undefined">
      <span v-if="event.odds !== undefined">{{ event.kind === 'precheck_result' ? '预检赔率' : '记录赔率' }} @{{ event.odds }}</span>
      <span v-if="event.amount !== undefined">金额 {{ event.amount }} {{ event.currency || '币种未记录' }}</span>
      <span v-if="event.planAmount !== undefined">计划金额 {{ event.planAmount }}（原记录未标明单位）</span>
      <span v-if="event.exchange !== undefined">换算值 {{ event.exchange }}</span>
      <span v-if="event.rate !== undefined">记录费率 {{ event.rate }}</span>
    </p>
    <p>发生 {{ time(event.occurredAt) }} · 服务端接收 {{ time(event.receivedAt) }}<span v-if="event.durationMs !== undefined"> · 耗时 {{ event.durationMs }}ms</span></p>
    <p>来源 {{ adminObservationSource(event) }} · 原始结果 {{ event.outcome || '未记录' }}<span v-if="event.observedStatus"> · 原始订单状态 {{ event.observedStatus }}</span></p>
    <p v-if="event.provider || event.accountId !== undefined || event.orderId">{{ event.provider || '系统' }} · 账号 {{ event.accountId ?? '未记录' }} · 订单 {{ event.orderId || '未记录' }}</p>
    <p v-if="event.httpStatus !== undefined || event.responseCode || event.errorCategory">HTTP {{ event.httpStatus ?? '未记录' }} · 返回码 {{ event.responseCode || '未记录' }} · 异常类别 {{ event.errorCategory || '未记录' }}</p>
    <p v-if="event.reasonCode || event.safeSummary">{{ event.reasonCode }} {{ event.safeSummary }}</p>
    <small>记录 {{ event.eventId }} · 序号 {{ event.sequence }} · 完整 Link {{ event.linkId }}<template v-if="event.phase"> · 阶段 {{ event.phase }}</template></small>
  </div>
</template>

<style scoped>
.observation-event { margin-top: 7px; padding: 8px; background: var(--adm-bg, #111827); border-radius: 5px; overflow-wrap: anywhere; }
p { margin: 3px 0; line-height: 1.6; } span + span { margin-left: 12px; } small { color: var(--adm-text-dim, #94a3b8); }
</style>
