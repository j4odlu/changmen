<script setup lang="ts">
import type { AdminOrderLogLookup } from "@/types/admin";
import { computed } from "vue";
import { adminObservationAttempts } from "@/shared/adminOrderObservation";
import { adminOrderBetMoneyCny, adminOrderMoneyCny, isAdminPredictionSell } from "@/shared/adminOrderMoney";
import AdminOrderObservationEvent from "./AdminOrderObservationEvent.vue";
import AdminOrderExecutionProgress from "./AdminOrderExecutionProgress.vue";
const props = defineProps<{ data: AdminOrderLogLookup }>();
const attempts = computed(() => adminObservationAttempts(props.data));
const roots = computed(() => (props.data.observation?.events || []).filter(event => !event.attemptId && !event.queueId));
const queues = computed(() => (props.data.observation?.queues || []).map(queue => ({ ...queue,
  events: (props.data.observation?.events || []).filter(event => event.queueId === queue.queueId) })));
const unmatched = computed(() => props.data.orders.filter(order => !attempts.value.some(attempt => attempt.orders.includes(order))));
function time(at: number) { return new Date(at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }); }
</script>

<template>
  <section class="execution-records">
    <AdminOrderExecutionProgress :data="data" />
    <details class="execution-records__evidence">
      <summary>完整记录与补单队列 · {{ attempts.length }} 组关联记录 · {{ data.observation?.events.length || 0 }} 条事件</summary>
      <h4>执行诊断 · 直接记录</h4>
      <p>按执行和尝试关联；接口受理、场馆确认和当前订单状态分别展示。事件由客户端上报，当前订单状态未提供历史更新时间。</p>
      <p>完整 Link {{ data.link }} · 查询锚点 {{ data.anchor.type }} / {{ data.anchor.value }}</p>
      <section v-if="roots.length" class="record-card">
        <h5>编排与执行记录</h5>
        <div v-for="event in roots" :key="event.eventId">
          <p>执行 {{ event.executionId || '未记录' }}</p>
          <AdminOrderObservationEvent :event="event" />
        </div>
      </section>
      <section v-for="(attempt, index) in attempts" :key="attempt.attemptId" class="record-card">
        <h5>{{ index + 1 }}. {{ attempt.provider }} · {{ attempt.target === 'Home' ? '主队' : attempt.target === 'Away' ? '客队' : attempt.target }} · 账号 {{ attempt.accountId }}</h5>
        <p>尝试 {{ attempt.attemptId }} · 执行 {{ attempt.executionId }}</p>
        <p>父尝试 {{ attempt.parentAttemptId }} · 重试轮次 {{ attempt.retryRound }} · 补单队列 {{ attempt.queueId }}</p>
        <div class="record-stages">
          <section v-for="stage in attempt.stages" :key="stage.key">
            <h5>{{ stage.title }} · {{ stage.label }}</h5>
            <p v-if="stage.detail">{{ stage.detail }}</p>
            <AdminOrderObservationEvent v-for="event in stage.events" :key="event.eventId" :event="event" />
            <p v-if="!stage.events.length && !stage.records.length">未提供该阶段的明确记录；不据此认定未发生。</p>
            <p v-for="record in stage.records" :key="`${record.provider}:${record.accountId}:${record.orderId}`">当前记录 {{ record.provider }} / {{ record.accountId }} / {{ record.orderId }} · {{ record.status }}<template v-if="record.shares !== undefined"> · 份额 {{ record.shares }}</template></p>
          </section>
        </div>
        <p v-for="issue in attempt.findings" :key="issue" class="record-issue">核查提示：{{ issue }}</p>
        <section v-if="attempt.processEvents.length">
          <h5>本次尝试的其他过程与监控记录（按记录序号排列）</h5>
          <AdminOrderObservationEvent v-for="event in attempt.processEvents" :key="event.eventId" :event="event" />
        </section>
        <section v-if="attempt.orders.length">
          <h5>精确关联的当前订单</h5>
          <div v-for="order in attempt.orders" :key="`${order.provider}:${order.playerId}:${order.orderId}`" class="order-record">
            <p>{{ order.match }} · {{ order.bet }} · {{ order.item }}</p>
            <p>{{ order.provider }} / {{ order.playerId }} / {{ order.orderId }} · 当前状态 {{ order.status }} · 下单赔率 @{{ order.odds }}</p>
            <p>{{ isAdminPredictionSell(order) ? '卖出回款' : '订单金额' }} ¥{{ adminOrderBetMoneyCny(order) }} · 当前损益 ¥{{ adminOrderMoneyCny(order) }} · 创建 {{ time(order.createAt) }}</p>
            <p v-if="order.pmSide || order.pfSide">买卖方向 {{ order.pmSide || order.pfSide }}</p>
            <p v-if="order.pmSellProceeds !== undefined || order.pfSellProceeds !== undefined">累计卖出回款 {{ order.pmSellProceeds ?? order.pfSellProceeds }} {{ order.provider === 'Polymarket' ? 'USDC' : 'USDT' }}</p>
            <p v-for="sell in order.positionEvents?.sells || []" :key="sell.id">减仓 {{ sell.id }} · {{ sell.at ? time(sell.at) : '时间未记录' }} · 份额 {{ sell.shares ?? '未记录' }} · 价格 {{ sell.price ?? '未记录' }} · 回款 {{ sell.proceeds ?? '未记录' }} · 损益 {{ sell.pnl ?? '未记录' }} · 来源 {{ sell.origin || '未记录' }} · 状态 {{ sell.status || '未记录' }}</p>
          </div>
        </section>
      </section>
      <section v-for="queue in queues" :key="queue.queueId" class="record-card">
        <h5>补单队列 {{ queue.queueId }}</h5>
        <p v-for="issue in queue.findings" :key="issue" class="record-issue">{{ issue }}</p>
        <div v-for="event in queue.events" :key="event.eventId">
          <p v-if="event.anchorOrderId || event.anchorAttemptId">锚订单 {{ event.anchorOrderId || '未记录' }} · 锚尝试 {{ event.anchorAttemptId || '未记录' }}</p>
          <AdminOrderObservationEvent :event="event" />
        </div>
      </section>
      <section v-if="unmatched.length" class="record-card">
        <h5>同 Link 的其他当前订单（尚无精确尝试关联）</h5>
        <p v-for="order in unmatched" :key="`${order.provider}:${order.playerId}:${order.orderId}`">{{ order.provider }} / {{ order.playerId }} / {{ order.orderId }} · {{ order.match }} · {{ order.item }} @{{ order.odds }} · {{ order.status }}</p>
      </section>
      </details>
  </section>
</template>

<style scoped>
.execution-records { min-width: 0; overflow-wrap: anywhere; } h4 { font-size: 16px; } h5 { font-size: 13px; margin: 6px 0; }
p { font-size: 12px; line-height: 1.6; margin: 5px 0; } .record-card { border: 1px solid var(--adm-border, #334155); padding: 12px; border-radius: 7px; margin-top: 12px; }
.record-stages { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 10px; } .record-stages > section { min-width: 0; }
.record-issue { color: #fdba74; } .order-record { border-top: 1px solid var(--adm-border, #334155); padding-top: 5px; }
.execution-records__evidence { margin-top: 14px; border-top: 1px solid var(--adm-border); } .execution-records__evidence > summary { padding: 12px 0; cursor: pointer; color: var(--adm-text-secondary); font-size: 12px; } .execution-records__evidence > summary:focus-visible { outline: 2px solid #93c5fd; outline-offset: 2px; }
@media (max-width: 700px) { .record-stages { grid-template-columns: 1fr; } }
</style>
