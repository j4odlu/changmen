<script setup lang="ts">
import type { OrderObservationEvent } from "@changmen/shared/order_observation";
import { observationEventLabel, observationEventStage } from "@changmen/shared/order_observation_view";
import { computed } from "vue";
import { adminObservationSource } from "@/shared/adminOrderObservation";
const props = defineProps<{ event: Readonly<OrderObservationEvent> }>();
// [changmen 扩展] 仅按事件的明确来源区分检测路径，不从耗时推断配置等待时间。
const path = computed(() => props.event.source === "ray_monitor" ? "RAY 旁路监控"
  : props.event.phase === "reject_detection" ? "主流程拒单检测" : observationEventStage(props.event));
const tone = computed(() => props.event.source === "ray_monitor" ? "monitor"
  : props.event.phase === "reject_detection" ? "detection" : "default");
const label = computed(() => observationEventLabel({ ...props.event, httpStatus: undefined, responseCode: undefined,
  durationMs: undefined, retryRound: undefined }).replace(/^(RAY订单监控|拒单检测) · /, ""));
function time(at?: number) { return at ? new Date(at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "未记录"; }
function clock(at: number) { return new Date(at).toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }); }
</script>

<template>
  <article class="observation-event" :data-path="tone">
    <div class="observation-event__heading">
      <time :title="time(event.occurredAt)">{{ clock(event.occurredAt) }}</time>
      <span class="observation-event__path">{{ path }}</span>
      <strong>{{ label }}</strong>
    </div>
    <div v-if="event.odds !== undefined || event.amount !== undefined || event.planAmount !== undefined || event.exchange !== undefined || event.rate !== undefined || event.durationMs !== undefined" class="observation-event__values">
      <span v-if="event.odds !== undefined">{{ event.kind === 'precheck_result' ? '预检赔率' : '记录赔率' }} @{{ event.odds }}</span>
      <span v-if="event.amount !== undefined">金额 {{ event.amount }} {{ event.currency || '币种未记录' }}</span>
      <span v-if="event.planAmount !== undefined">计划金额 {{ event.planAmount }}（原记录未标明单位）</span>
      <span v-if="event.exchange !== undefined">换算值 {{ event.exchange }}</span>
      <span v-if="event.rate !== undefined">记录费率 {{ event.rate }}</span>
      <span v-if="event.durationMs !== undefined">耗时 {{ event.durationMs }}ms</span>
    </div>
    <p v-if="event.orderId" class="observation-event__order">订单 <code>{{ event.orderId }}</code></p>
    <details class="observation-event__receipt">
      <summary>记录详情</summary>
      <dl>
        <dt>来源</dt><dd>{{ adminObservationSource(event) }}<template v-if="event.phase"> · 阶段 {{ event.phase }}</template></dd>
        <dt>原始结果</dt><dd>{{ event.outcome || '未记录' }}<template v-if="event.observedStatus"> · 订单状态 {{ event.observedStatus }}</template></dd>
        <dt>发生 / 接收</dt><dd>{{ time(event.occurredAt) }} / {{ time(event.receivedAt) }}</dd>
        <template v-if="event.provider || event.accountId !== undefined"><dt>场馆 / 账号</dt><dd>{{ event.provider || '系统' }} / {{ event.accountId ?? '未记录' }}</dd></template>
        <template v-if="event.httpStatus !== undefined || event.responseCode || event.errorCategory"><dt>接口回执</dt><dd>HTTP {{ event.httpStatus ?? '未记录' }} · 返回码 {{ event.responseCode || '未记录' }} · 异常类别 {{ event.errorCategory || '未记录' }}</dd></template>
        <template v-if="event.reasonCode || event.safeSummary"><dt>原因</dt><dd>{{ event.reasonCode }} {{ event.safeSummary }}</dd></template>
        <dt>事件编号</dt><dd><code>{{ event.eventId }}</code> · 序号 {{ event.sequence }}</dd>
        <dt>执行 / 尝试</dt><dd><code>{{ event.executionId || '未记录' }}</code> / <code>{{ event.attemptId || '未记录' }}</code></dd>
        <template v-if="event.queueId || event.anchorOrderId || event.anchorAttemptId"><dt>补单关联</dt><dd>队列 {{ event.queueId || '未记录' }} · 锚订单 {{ event.anchorOrderId || '未记录' }} · 锚尝试 {{ event.anchorAttemptId || '未记录' }}</dd></template>
        <dt>完整 Link</dt><dd><code>{{ event.linkId }}</code></dd>
      </dl>
    </details>
  </article>
</template>

<style scoped>
.observation-event { padding: 12px 0 12px 14px; border-left: 2px solid var(--adm-border, #334155); overflow-wrap: anywhere; }
.observation-event + .observation-event { border-top: 1px solid var(--adm-border, #334155); }
.observation-event__heading { display: flex; align-items: baseline; flex-wrap: wrap; gap: 7px 10px; }
time { font-size: 11px; color: var(--adm-text-secondary, #8fa3be); font-variant-numeric: tabular-nums; }
strong { font-size: 12px; font-weight: 500; line-height: 1.6; flex: 1 1 230px; }
.observation-event__path { font-size: 10px; color: var(--adm-text-secondary, #8fa3be); border-radius: 4px; background: var(--adm-surface-2, #1a2640); padding: 2px 6px; }
[data-path="monitor"] { border-left-color: #c4b5fd; } [data-path="monitor"] .observation-event__path { background: rgba(167, 139, 250, .12); color: #c4b5fd; }
[data-path="detection"] { border-left-color: #7dd3fc; } [data-path="detection"] .observation-event__path { background: rgba(56, 189, 248, .12); color: #7dd3fc; }
.observation-event__values { display: flex; flex-wrap: wrap; gap: 5px 16px; font-size: 11px; margin-top: 6px; }
.observation-event__order { margin: 6px 0; font-size: 11px; color: var(--adm-text-secondary, #8fa3be); }
code { font-size: 11px; overflow-wrap: anywhere; }
summary { cursor: pointer; font-size: 11px; color: var(--adm-text-secondary, #8fa3be); padding-top: 6px; }
summary:focus-visible { outline: 2px solid #93c5fd; outline-offset: 3px; }
dl { display: grid; grid-template-columns: 88px minmax(0, 1fr); gap: 7px 12px; font-size: 11px; line-height: 1.6; background: var(--adm-surface-2, #1a2640); padding: 10px; border-radius: 5px; }
dt { color: var(--adm-text-secondary, #8fa3be); } dd { margin: 0; }
@media (max-width: 500px) { dl { grid-template-columns: 1fr; gap: 3px; } dd { margin-bottom: 6px; } }
</style>
