<script setup lang="ts">
import type { AdminOrderLogLookup } from "@/types/admin";
import { computed, nextTick, ref, watch } from "vue";
import { orderObservationTimeline } from "@changmen/shared/order_observation_view";
import { adminObservationAttemptKind, adminObservationAttempts } from "@/shared/adminOrderObservation";
import { adminOrderBetMoneyCny, adminOrderMoneyCny, isAdminPredictionSell } from "@/shared/adminOrderMoney";
import AdminOrderObservationEvent from "./AdminOrderObservationEvent.vue";
import AdminOrderExecutionProgress from "./AdminOrderExecutionProgress.vue";

// [changmen 扩展] 完整证据按用途浏览；只投影已有记录，不参与下注或拒单判定。
const props = defineProps<{ data: AdminOrderLogLookup }>();
const attempts = computed(() => adminObservationAttempts(props.data));
type AttemptKind = ReturnType<typeof adminObservationAttemptKind>;
type Section = "attempts" | "queues" | "execution" | "orders";
const section = ref<Section>("attempts");
const category = ref<AttemptKind>();
type Leg = "Home" | "Away" | "unknown";
const pages = ref<Record<Leg, number>>({ Home: 1, Away: 1, unknown: 1 });
const evidencePane = ref<HTMLDetailsElement | null>(null);
const evidenceOpen = ref(false);
const focusedAttemptId = ref("");
const PAGE_SIZE = 20;
const categories = computed(() => ([
  { kind: "submission" as const, label: "提交下注" },
  { kind: "precheck" as const, label: "仅预检" },
  { kind: "other" as const, label: "监控及其他" },
]).map(item => ({ ...item, count: attempts.value.filter(attempt => adminObservationAttemptKind(attempt) === item.kind).length }))
  .filter(item => item.count));
const currentCategory = computed(() => categories.value.find(item => item.kind === category.value) || categories.value[0]);
const filteredAttempts = computed(() => attempts.value.filter(attempt => adminObservationAttemptKind(attempt) === currentCategory.value?.kind));
function legOf(target: string): Leg { return target === "Home" || target === "Away" ? target : "unknown"; }
const attemptLanes = computed(() => (["Home", "Away", "unknown"] as const).map(leg => {
  const records = filteredAttempts.value.filter(attempt => legOf(attempt.target) === leg);
  const pageCount = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
  const currentPage = Math.min(pages.value[leg], pageCount);
  return { leg, label: side(leg), count: records.length, pageCount, currentPage,
    shownAttempts: records.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE) };
}).filter(lane => lane.leg !== "unknown" || lane.count));
const queues = computed(() => (props.data.observation?.queues || []).map(queue => ({ ...queue,
  events: orderObservationTimeline((props.data.observation?.events || []).filter(event => event.queueId === queue.queueId
    && (event.kind.startsWith("queue_") || !event.attemptId))),
  attempts: attempts.value.filter(attempt => attempt.events.some(event => event.queueId === queue.queueId)),
  anchorOrderIds: [...new Set((props.data.observation?.events || []).filter(event => event.queueId === queue.queueId)
    .map(event => event.anchorOrderId).filter(Boolean))],
})));
const executionEvents = computed(() => {
  const shown = new Set(attempts.value.flatMap(attempt => attempt.events.map(event => event.eventId)));
  for (const queue of queues.value) for (const event of queue.events) shown.add(event.eventId);
  return orderObservationTimeline((props.data.observation?.events || []).filter(event => !shown.has(event.eventId)));
});
const sections = computed(() => [
  { key: "attempts" as const, label: "下单记录", count: attempts.value.length },
  { key: "queues" as const, label: "补单队列", count: queues.value.length },
  { key: "execution" as const, label: "整单与未归组", count: executionEvents.value.length },
  { key: "orders" as const, label: "当前订单", count: props.data.orders.length },
]);
watch(() => props.data, () => { section.value = "attempts"; category.value = undefined; pages.value = { Home: 1, Away: 1, unknown: 1 }; evidenceOpen.value = false; focusedAttemptId.value = ""; });
function selectCategory(kind: AttemptKind) { category.value = kind; pages.value = { Home: 1, Away: 1, unknown: 1 }; focusedAttemptId.value = ""; }
async function inspectAttempt(attemptId: string) {
  const attempt = attempts.value.find(item => item.attemptId === attemptId);
  if (!attempt) return;
  const kind = adminObservationAttemptKind(attempt);
  const leg = legOf(attempt.target);
  const matching = attempts.value.filter(item => adminObservationAttemptKind(item) === kind && legOf(item.target) === leg);
  section.value = "attempts";
  category.value = kind;
  pages.value[leg] = Math.floor(matching.indexOf(attempt) / PAGE_SIZE) + 1;
  focusedAttemptId.value = attemptId;
  evidenceOpen.value = true;
  await nextTick();
  const card = [...(evidencePane.value?.querySelectorAll<HTMLDetailsElement>("[data-attempt-id]") || [])]
    .find(item => item.dataset.attemptId === attemptId);
  card?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
function clock(at?: number) { return at ? new Date(at).toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "时间未记录"; }
function time(at?: number) { return at ? new Date(at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "时间未记录"; }
function side(target: string) { return target === "Home" ? "主队腿" : target === "Away" ? "客队腿" : "方向待核查"; }
function phaseLabel(attempt: typeof attempts.value[number]) {
  const phases = [...new Set(attempt.events.map(event => event.phase).filter(phase => ["initial", "retry", "makeup"].includes(phase || "")))];
  return phases.length === 1 ? ({ initial: "首轮", retry: "重试", makeup: "补单" }[phases[0]!] || "") : "";
}
function attemptResult(attempt: typeof attempts.value[number]) {
  return adminObservationAttemptKind(attempt) === "precheck" ? attempt.stages[0]!.label : attempt.stages[3]!.label;
}
function orderStatus(status: string) {
  return ({ none: "未结算", pending: "待确认", reject: "拒单", win: "已结算 · 赢", lose: "已结算 · 输", return: "已退回" } as Record<string, string>)[status.toLowerCase()] || status;
}
function tone(label: string) {
  if (/冲突|未知|待确认|缺少|未记录/.test(label)) return "warning";
  if (/拒单|失败|未成交|取消/.test(label)) return "danger";
  if (/已成交|成交确认|已结算|已保存|通过/.test(label)) return "success";
  return "neutral";
}
</script>

<template>
  <section class="execution-records">
    <AdminOrderExecutionProgress :data="data" @inspect-attempt="inspectAttempt" />
    <details ref="evidencePane" class="evidence-browser" :open="evidenceOpen" @toggle="evidenceOpen = ($event.target as HTMLDetailsElement).open">
      <summary class="evidence-browser__summary">
        <span>完整记录与补单队列</span>
        <small>{{ attempts.length }} 组记录 · {{ data.observation?.events.length || 0 }} 条事件</small>
      </summary>
      <div class="evidence-browser__content">
        <nav class="evidence-browser__nav" aria-label="诊断记录分类">
          <button v-for="item in sections" :key="item.key" type="button" :aria-pressed="section === item.key" @click="section = item.key">
            {{ item.label }} <span>{{ item.count }}</span>
          </button>
        </nav>
        <p class="evidence-browser__context">完整 Link <code>{{ data.link }}</code><span v-if="data.observation?.truncated"> · 记录已截断，计数仅代表本次查询结果</span></p>

        <section v-if="section === 'attempts'" aria-label="下单记录">
          <div class="evidence-browser__toolbar">
            <div class="evidence-browser__filters" aria-label="下单记录类型">
              <button v-for="item in categories" :key="item.kind" type="button" :aria-pressed="currentCategory?.kind === item.kind" @click="selectCategory(item.kind)">{{ item.label }} {{ item.count }}</button>
            </div>
            <span class="evidence-browser__hint">主客腿各自展开、翻页；窄屏可横向滑动</span>
          </div>
          <p v-if="!filteredAttempts.length" class="evidence-browser__empty">暂无关联的尝试记录，可查看整单与未归组事件。</p>
          <div v-else class="evidence-legs-scroll" tabindex="0" aria-label="主客腿完整记录，支持横向滚动">
            <div class="evidence-legs">
              <section v-for="lane in attemptLanes" :key="lane.leg" class="evidence-leg" :data-leg="lane.leg" :aria-label="`${lane.label}完整记录`">
                <header class="evidence-leg__header"><strong>{{ lane.label }}</strong><span>{{ lane.count }} 组记录</span></header>
                <p v-if="!lane.count" class="evidence-browser__empty">本分类暂无{{ lane.label }}记录</p>
                <details v-for="(attempt, index) in lane.shownAttempts" :key="attempt.attemptId" class="attempt-card" :data-attempt-id="attempt.attemptId" :open="focusedAttemptId ? attempt.attemptId === focusedAttemptId : currentCategory?.kind === 'submission' && index === 0">
                  <summary class="attempt-card__summary">
                    <span class="attempt-card__number">{{ (lane.currentPage - 1) * PAGE_SIZE + index + 1 }}</span>
                    <span class="attempt-card__identity"><strong>{{ attempt.provider }} · {{ side(attempt.target) }}</strong><small :title="time(attempt.events[0]?.occurredAt)">账号 {{ attempt.accountId }}<template v-if="phaseLabel(attempt)"> · {{ phaseLabel(attempt) }}</template> · {{ clock(attempt.events[0]?.occurredAt) }}</small></span>
                    <span class="evidence-status" :data-tone="tone(attemptResult(attempt))">{{ attemptResult(attempt) }}</span>
                    <small class="attempt-card__count">{{ attempt.events.length }} 条</small>
                  </summary>
                  <div class="attempt-card__body">
                    <ul v-if="attempt.findings.length" class="evidence-issues"><li v-for="issue in attempt.findings" :key="issue">{{ issue }}</li></ul>
                    <div class="evidence-timeline__heading"><h5>本次尝试时间线</h5><span>紫色：RAY 旁路监控 · 蓝色：主流程拒单检测</span></div>
                    <div class="evidence-timeline">
                      <AdminOrderObservationEvent v-for="event in orderObservationTimeline(attempt.events)" :key="event.eventId" :event="event" />
                    </div>
                    <details class="evidence-identifiers">
                      <summary>关联编号</summary>
                      <dl><dt>尝试</dt><dd><code>{{ attempt.attemptId }}</code></dd><dt>执行</dt><dd><code>{{ attempt.executionId }}</code></dd><dt>父尝试</dt><dd><code>{{ attempt.parentAttemptId }}</code></dd><dt>重试轮次</dt><dd>{{ attempt.retryRound }}</dd><dt>补单队列</dt><dd><code>{{ attempt.queueId }}</code></dd></dl>
                      <template v-for="stage in attempt.stages" :key="stage.key">
                        <p v-if="stage.detail">{{ stage.title }}依据：{{ stage.detail }}</p>
                        <p v-for="record in stage.records" :key="`${record.provider}:${record.accountId}:${record.orderId}`">{{ stage.title }}关联订单 {{ record.orderId }} · {{ orderStatus(record.status) }}<template v-if="record.shares !== undefined"> · 份额 {{ record.shares }}</template></p>
                      </template>
                    </details>
                  </div>
                </details>
                <div v-if="lane.pageCount > 1" class="evidence-pagination" :aria-label="`${lane.label}记录分页`">
                  <button type="button" :disabled="lane.currentPage <= 1" @click="pages[lane.leg] = lane.currentPage - 1">上一页</button>
                  <span>第 {{ lane.currentPage }} / {{ lane.pageCount }} 页 · 每页 {{ PAGE_SIZE }} 组</span>
                  <button type="button" :disabled="lane.currentPage >= lane.pageCount" @click="pages[lane.leg] = lane.currentPage + 1">下一页</button>
                </div>
              </section>
            </div>
          </div>
        </section>

        <section v-else-if="section === 'queues'" aria-label="补单队列">
          <p class="evidence-browser__hint">每个队列单独展示入队、撤销和后续处理；下单过程在「下单记录」查看。</p>
          <p v-if="!queues.length" class="evidence-browser__empty">未记录补单队列。</p>
          <details v-for="(queue, index) in queues" :key="queue.queueId" class="attempt-card" :open="index === 0">
            <summary class="attempt-card__summary"><strong>补单队列 {{ index + 1 }}</strong><small>{{ queue.events.length }} 条队列事件 · {{ queue.attempts.length }} 组关联记录</small><span v-if="queue.findings.length" class="evidence-status" data-tone="warning">{{ queue.findings.length }} 项核查提示</span></summary>
            <div class="attempt-card__body">
              <p class="evidence-browser__context">队列编号 <code>{{ queue.queueId }}</code></p>
              <p v-if="queue.anchorOrderIds.length" class="evidence-browser__context">锚订单 <code v-for="id in queue.anchorOrderIds" :key="id">{{ id }} </code></p>
              <ul v-if="queue.findings.length" class="evidence-issues"><li v-for="issue in queue.findings" :key="issue">{{ issue }}</li></ul>
              <AdminOrderObservationEvent v-for="event in queue.events" :key="event.eventId" :event="event" />
              <details v-if="queue.attempts.length" class="evidence-identifiers"><summary>关联的下单与预检记录 · {{ queue.attempts.length }} 组</summary><p v-for="attempt in queue.attempts" :key="attempt.attemptId">{{ attempt.provider }} · {{ side(attempt.target) }} · 账号 {{ attempt.accountId }} · {{ clock(attempt.events[0]?.occurredAt) }} · <code>{{ attempt.attemptId }}</code></p></details>
            </div>
          </details>
        </section>

        <section v-else-if="section === 'execution'" aria-label="整单与未归组事件">
          <p class="evidence-browser__hint">整轮执行事件及未关联到尝试或队列的记录，保留原有身份。</p>
          <p v-if="!executionEvents.length" class="evidence-browser__empty">暂无整单或未归组事件。</p>
          <AdminOrderObservationEvent v-for="event in executionEvents" :key="event.eventId" :event="event" />
        </section>

        <section v-else aria-label="当前订单">
          <p class="evidence-browser__hint">这是当前订单快照；历史检测时间与来源请查看下单时间线。</p>
          <p v-if="!data.orders.length" class="evidence-browser__empty">暂无当前订单记录。</p>
          <article v-for="order in data.orders" :key="`${order.provider}:${order.playerId}:${order.orderId}`" class="order-record">
            <header><strong>{{ order.provider }} · 账号 {{ order.playerId }}</strong><span class="evidence-status" :data-tone="tone(orderStatus(order.status))">{{ orderStatus(order.status) }}</span></header>
            <h5>{{ order.match }}</h5><p>{{ order.bet }} · {{ order.item }}</p>
            <div class="order-record__values"><span>下单赔率 @{{ order.odds }}</span><span>{{ isAdminPredictionSell(order) ? '卖出回款' : '订单金额' }} ¥{{ adminOrderBetMoneyCny(order) }}</span><span>当前损益 ¥{{ adminOrderMoneyCny(order) }}</span></div>
            <p class="evidence-browser__context">订单 <code>{{ order.orderId }}</code> · 创建 {{ time(order.createAt) }}</p>
            <p v-if="!attempts.some(attempt => attempt.orders.includes(order))" class="evidence-browser__hint">尚无精确尝试关联</p>
            <details v-if="order.pmSide || order.pfSide || order.positionEvents?.sells?.length" class="evidence-identifiers"><summary>持仓与减仓记录</summary>
              <p v-if="order.pmSide || order.pfSide">买卖方向 {{ order.pmSide || order.pfSide }}</p>
              <p v-if="order.pmSellProceeds !== undefined || order.pfSellProceeds !== undefined">累计卖出回款 {{ order.pmSellProceeds ?? order.pfSellProceeds }} {{ order.provider === 'Polymarket' ? 'USDC' : 'USDT' }}</p>
              <p v-for="sell in order.positionEvents?.sells || []" :key="sell.id">减仓 {{ sell.id }} · {{ sell.at ? time(sell.at) : '时间未记录' }} · 份额 {{ sell.shares ?? '未记录' }} · 价格 {{ sell.price ?? '未记录' }} · 回款 {{ sell.proceeds ?? '未记录' }} · 损益 {{ sell.pnl ?? '未记录' }} · 来源 {{ sell.origin || '未记录' }} · 状态 {{ sell.status || '未记录' }}</p>
            </details>
          </article>
        </section>
        <p class="evidence-browser__note">事件由客户端上报；缺少记录不代表未发生。查询锚点 {{ data.anchor.type }} / {{ data.anchor.value }}</p>
      </div>
    </details>
  </section>
</template>

<style scoped>
.execution-records { min-width: 0; overflow-wrap: anywhere; color: var(--adm-text, #eef1f6); font-size: 12px; }
.evidence-browser { margin-top: 18px; border: 1px solid var(--adm-border, #334155); border-radius: 9px; background: var(--adm-surface, #131c2e); }
.evidence-browser__summary { padding: 16px; cursor: pointer; font-size: 13px; font-weight: 600; }
.evidence-browser__summary small { margin-left: 12px; font-weight: 400; color: var(--adm-text-secondary, #8fa3be); font-size: 11px; }
.evidence-browser__content { padding: 0 16px 16px; }
.evidence-browser__nav { display: flex; flex-wrap: wrap; gap: 6px; padding-bottom: 12px; border-bottom: 1px solid var(--adm-border, #334155); }
button { font: inherit; color: var(--adm-text-secondary, #8fa3be); background: transparent; border: 1px solid var(--adm-border, #334155); border-radius: 6px; padding: 7px 11px; cursor: pointer; }
button[aria-pressed="true"] { color: #bfdbfe; background: rgba(96, 165, 250, .12); border-color: rgba(96, 165, 250, .5); }
button:hover:not(:disabled) { border-color: #93c5fd; } button:disabled { opacity: .4; cursor: default; }
button:focus-visible, summary:focus-visible { outline: 2px solid #93c5fd; outline-offset: 3px; }
.evidence-browser__nav span { margin-left: 6px; font-size: 10px; color: var(--adm-text-secondary, #8fa3be); }
.evidence-browser__context { margin: 12px 0; color: var(--adm-text-secondary, #8fa3be); font-size: 11px; }
.evidence-browser__toolbar, .evidence-browser__filters { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.evidence-browser__toolbar { justify-content: space-between; margin: 14px 0; gap: 10px; } .evidence-browser__filters button { padding: 5px 9px; font-size: 11px; }
.evidence-browser__hint, .evidence-browser__note { color: var(--adm-text-secondary, #8fa3be); font-size: 11px; line-height: 1.7; }
.evidence-browser__empty { text-align: center; padding: 24px 12px; color: var(--adm-text-secondary, #8fa3be); }
.evidence-legs-scroll { overflow-x: auto; padding-bottom: 6px; }
.evidence-legs-scroll:focus-visible { outline: 2px solid #93c5fd; outline-offset: 2px; }
.evidence-legs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; min-width: 740px; align-items: start; }
.evidence-leg { min-width: 0; padding: 12px; border: 1px solid var(--adm-border, #334155); border-radius: 8px; }
.evidence-leg[data-leg="unknown"] { grid-column: 1 / -1; }
.evidence-leg__header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-bottom: 10px; border-bottom: 1px solid var(--adm-border, #334155); }
.evidence-leg__header strong { font-size: 13px; }
.evidence-leg__header span { color: var(--adm-text-secondary, #8fa3be); font-size: 11px; }
.evidence-leg .attempt-card__summary { gap: 8px; padding: 10px; }
.evidence-leg .attempt-card__identity { min-width: 120px; flex-basis: auto; }
.evidence-leg .attempt-card__body { padding: 10px; }
.evidence-leg .evidence-pagination { flex-wrap: wrap; gap: 8px; }
.evidence-leg .evidence-pagination button { padding: 5px 8px; }
.attempt-card { border: 1px solid var(--adm-border, #334155); border-radius: 7px; margin-top: 10px; }
.attempt-card__summary { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; padding: 13px; cursor: pointer; list-style: none; }
.attempt-card__summary::-webkit-details-marker { display: none; }
.attempt-card__summary::after { content: '›'; color: var(--adm-text-secondary, #8fa3be); font-size: 18px; margin-left: auto; }
.attempt-card[open] > .attempt-card__summary::after { transform: rotate(90deg); }
.attempt-card[open] > .attempt-card__summary { border-bottom: 1px solid var(--adm-border, #334155); background: var(--adm-surface-2, #1a2640); border-radius: 7px 7px 0 0; }
.attempt-card__number { display: inline-grid; place-items: center; width: 25px; height: 25px; border-radius: 6px; background: rgba(96, 165, 250, .1); color: #93c5fd; font-size: 11px; }
.attempt-card__identity { display: grid; gap: 4px; min-width: 140px; flex: 1; }
.attempt-card__identity small, .attempt-card__count, .attempt-card__summary > small { color: var(--adm-text-secondary, #8fa3be); font-size: 10px; }
.attempt-card__body { padding: 14px; }
.evidence-status { font-size: 11px; padding: 4px 7px; background: rgba(148, 163, 184, .08); border-radius: 5px; }
[data-tone="warning"] { color: #fcd34d; } [data-tone="danger"] { color: #fda4af; } [data-tone="success"] { color: #6ee7b7; }
.evidence-issues { color: #fcd34d; padding: 10px 12px 10px 28px; background: rgba(251, 191, 36, .06); border-radius: 5px; font-size: 11px; line-height: 1.8; }
.evidence-timeline__heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px; margin: 18px 0 8px; }
h5 { font-size: 12px; margin: 0; } .evidence-timeline__heading span { font-size: 10px; color: var(--adm-text-secondary, #8fa3be); }
.evidence-identifiers { border-top: 1px solid var(--adm-border, #334155); margin-top: 12px; padding-top: 9px; font-size: 11px; }
.evidence-identifiers summary { cursor: pointer; color: var(--adm-text-secondary, #8fa3be); }
code { font-size: 11px; overflow-wrap: anywhere; }
dl { display: grid; grid-template-columns: 70px minmax(0, 1fr); gap: 6px 12px; } dt { color: var(--adm-text-secondary, #8fa3be); } dd { margin: 0; }
.evidence-pagination { display: flex; align-items: center; justify-content: center; gap: 12px; margin-top: 16px; font-size: 11px; }
.order-record { padding: 14px; border: 1px solid var(--adm-border, #334155); border-radius: 7px; margin-top: 10px; }
.order-record header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 12px; } .order-record p { line-height: 1.6; }
.order-record__values { display: flex; flex-wrap: wrap; gap: 8px 20px; margin-top: 12px; }
.evidence-browser__note { border-top: 1px solid var(--adm-border, #334155); margin: 16px 0 0; padding-top: 10px; }
@media (max-width: 700px) { .attempt-card__count { display: none; } }
@media (max-width: 450px) { .evidence-browser__content { padding: 0 10px 10px; } .evidence-browser__summary { padding: 13px 10px; } .evidence-browser__summary small { display: block; margin: 7px 0 0 16px; } .attempt-card__body { padding: 10px; } .attempt-card__identity { flex-basis: calc(100% - 45px); } .attempt-card__summary { gap: 7px; } .evidence-pagination { gap: 7px; } }
</style>
