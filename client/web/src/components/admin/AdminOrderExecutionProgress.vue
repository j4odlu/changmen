<script setup lang="ts">
import type { AdminOrderLogLookup } from "@/types/admin";
import { observationEventLabel, observationEventStage, orderObservationTimeline } from "@changmen/shared/order_observation_view";
import { computed, ref } from "vue";
import { adminObservationAttemptKind, adminObservationExecutions } from "@/shared/adminOrderObservation";

/** [changmen 扩展] 借鉴实时进度的双腿对照，只展示已有记录与服务端结论。 */
const props = defineProps<{ data: AdminOrderLogLookup }>();
const executions = computed(() => adminObservationExecutions(props.data));
const selectedExecution = ref("");
const selection = ref<Record<string, string>>({});
type AttemptKind = ReturnType<typeof adminObservationAttemptKind>;
const categorySelection = ref<Record<string, AttemptKind>>({});
const categoryLabels: Record<AttemptKind, string> = { submission: "提交阶段", precheck: "仅预检", other: "其他记录" };
const counts = computed(() => {
  const result = { submission: 0, precheck: 0, other: 0 };
  for (const attempt of props.data.observation?.attempts || []) result[adminObservationAttemptKind(attempt)]++;
  return result;
});
const current = computed(() => executions.value.find(item => item.key === selectedExecution.value) || executions.value[0]);
const lanes = computed(() => current.value?.lanes.map(lane => {
  const key = `${current.value!.key}:${lane.key}`;
  const categories = (["submission", "precheck", "other"] as const).map(kind => ({ kind, label: categoryLabels[kind],
    attempts: lane.attempts.filter(attempt => adminObservationAttemptKind(attempt) === kind),
  })).filter(category => category.attempts.length);
  const category = categories.find(item => item.kind === categorySelection.value[key]) || categories[0];
  const available = category?.attempts || [];
  const selected = available.find(attempt => attempt.attemptId === selection.value[key]) || available.at(-1);
  const latestPrecheck = lane.attempts.filter(attempt => adminObservationAttemptKind(attempt) === "precheck").at(-1);
  const latestCheck = latestPrecheck?.events.filter(event => event.kind === "precheck_result").at(-1);
  return { ...lane, categories, category, available, latestCheck, selected: selected ? { ...selected,
    stages: selected.stages.map(stage => ({ ...stage, event: stage.events.at(-1) })),
  } : undefined };
}) || []);
const phases = ["预检", "提交下注", "绑定订单", "场馆确认 / 当前状态"];
const orchestration = computed(() => orderObservationTimeline((props.data.observation?.events || []).filter(event =>
  !event.attemptId && !event.queueId && (!current.value || event.executionId === current.value.executionId))));
function selectAttempt(key: string, attemptId: string) {
  if (current.value) selection.value[`${current.value.key}:${key}`] = attemptId;
}
function selectCategory(key: string, category: AttemptKind) {
  if (current.value) categorySelection.value[`${current.value.key}:${key}`] = category;
}
function attemptLabel(attempt: { events: readonly { occurredAt: number; phase?: string }[] }, index: number) {
  const phase = attempt.events.find(event => event.phase)?.phase;
  const phaseLabel = phase === "makeup" ? "补单" : phase === "retry" ? "重试" : phase === "initial" ? "首轮" : "";
  return `${index + 1} · ${phaseLabel} ${attempt.events[0] ? clock(attempt.events[0].occurredAt) : '时间未记录'}`;
}
function clock(at: number) { return new Date(at).toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }); }
function tone(label: string) {
  // 仅为已有结论配色，不产生新的成交或失败判定。
  if (/冲突|不一致|未知|超时|待确认/.test(label)) return "warning";
  if (/失败|拒单|未成交|未提交|已取消|已过期/.test(label)) return "danger";
  if (/通过|已保存|已成交|直接成交|已结算/.test(label)) return "success";
  if (/受理|正在|处理中/.test(label)) return "pending";
  return "muted";
}
</script>

<template>
  <section class="diagnosis-progress" aria-label="下单执行进度">
    <header class="diagnosis-progress__heading">
      <div><h4>下单执行进度</h4><p>两腿按阶段对照 · 预检轮询与提交记录分开查看</p></div>
      <div class="diagnosis-progress__counts">
        <small v-if="data.observation?.truncated">本次查询</small>
        <span v-for="(count, kind) in counts" :key="kind" v-show="count" class="diagnosis-progress__badge">{{ categoryLabels[kind] }} {{ count }} 组</span>
      </div>
    </header>
    <label v-if="executions.length > 1" class="diagnosis-progress__executions">切换执行
      <select :value="current?.key" aria-label="切换执行" @change="selectedExecution = ($event.target as HTMLSelectElement).value">
        <option v-for="(execution, index) in executions" :key="execution.key" :value="execution.key">执行 {{ index + 1 }} · {{ execution.attempts.length }} 组记录</option>
      </select>
    </label>
    <p class="diagnosis-progress__identity">执行编号 <code>{{ current?.executionId || '未提供唯一执行编号' }}</code></p>
    <div v-if="current" class="diagnosis-progress__scroll">
      <table class="diagnosis-progress__comparison" :style="{ minWidth: `${114 + lanes.length * 238}px` }" aria-label="主客两腿执行阶段对照">
        <thead><tr>
          <th scope="col" class="diagnosis-progress__phase-column">阶段</th>
          <th v-for="lane in lanes" :key="lane.key" scope="col">
            <div class="diagnosis-progress__leg-heading"><span>{{ lane.label }}</span><strong>{{ lane.selected?.provider === 'Polymarket' ? 'PM' : lane.selected?.provider || '—' }}</strong></div>
            <template v-if="lane.selected">
              <div class="diagnosis-progress__status" :data-tone="tone(lane.selected.stages[3]!.label)">{{ lane.selected.stages[3]!.label }}</div>
              <p class="diagnosis-progress__account">账号 {{ lane.selected.accountId }}</p>
              <nav class="diagnosis-progress__attempts" :aria-label="`${lane.label}记录分类`">
                <button v-for="category in lane.categories" :key="category.kind" type="button" :aria-pressed="lane.category?.kind === category.kind" @click="selectCategory(lane.key, category.kind)">{{ category.label }} {{ category.attempts.length }}</button>
              </nav>
              <select v-if="lane.available.length > 1" class="diagnosis-progress__history" :value="lane.selected.attemptId" :aria-label="`${lane.label}选择历史记录`" @change="selectAttempt(lane.key, ($event.target as HTMLSelectElement).value)">
                <option v-for="(attempt, index) in lane.available" :key="attempt.attemptId" :value="attempt.attemptId">{{ attemptLabel(attempt, index) }} · {{ attempt.provider }}</option>
              </select>
              <p v-if="lane.latestCheck" class="diagnosis-progress__check-summary">最近预检 · {{ lane.latestCheck.safeSummary || observationEventLabel(lane.latestCheck) }}</p>
              <code class="diagnosis-progress__attempt-id">{{ lane.selected.attemptId }}</code>
            </template>
            <p v-else class="diagnosis-progress__account">暂无此方向的尝试记录</p>
          </th>
        </tr></thead>
        <tbody>
          <tr v-for="(phase, index) in phases" :key="phase">
            <th scope="row"><span class="diagnosis-progress__step">{{ index + 1 }}</span>{{ phase }}</th>
            <td v-for="lane in lanes" :key="lane.key">
              <template v-if="lane.selected">
                <div class="diagnosis-progress__result" :data-tone="tone(lane.selected.stages[index]!.label)">
                  <span class="diagnosis-progress__dot" /><strong>{{ lane.selected.stages[index]!.label }}</strong>
                  <time v-if="lane.selected.stages[index]!.event">{{ clock(lane.selected.stages[index]!.event!.occurredAt) }}</time>
                </div>
                <div v-if="lane.selected.stages[index]!.event" class="diagnosis-progress__quote">
                  <span v-if="lane.selected.stages[index]!.event!.odds !== undefined">{{ index === 0 ? '预检赔率' : '记录赔率' }} @{{ lane.selected.stages[index]!.event!.odds }}</span>
                  <span v-if="lane.selected.stages[index]!.event!.amount !== undefined">{{ lane.selected.stages[index]!.event!.amount }} {{ lane.selected.stages[index]!.event!.currency || '币种未记录' }}</span>
                  <span v-if="lane.selected.stages[index]!.event!.durationMs !== undefined">耗时 {{ lane.selected.stages[index]!.event!.durationMs }}ms</span>
                </div>
                <p v-if="lane.selected.stages[index]!.detail" class="diagnosis-progress__basis">{{ lane.selected.stages[index]!.detail }}</p>
                <p v-if="lane.selected.stages[index]!.event?.safeSummary" class="diagnosis-progress__basis">{{ lane.selected.stages[index]!.event!.safeSummary }}</p>
              </template>
              <span v-else class="diagnosis-progress__empty">暂无记录</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="current" class="diagnosis-progress__mobile-hint">左右滑动查看两腿，阶段列固定显示</p>
    <div v-if="current" class="diagnosis-progress__timelines" :style="{ '--diagnosis-lanes': lanes.length }">
      <section v-for="lane in lanes" :key="lane.key" class="diagnosis-progress__timeline">
        <template v-if="lane.selected">
          <header><strong>{{ lane.label }} · 执行时间线</strong><span>{{ lane.selected.events.length }} 条记录</span></header>
          <p v-for="issue in lane.selected.findings" :key="issue" class="diagnosis-progress__issue">{{ issue }}</p>
          <details>
            <summary>查看本次尝试时间线</summary>
            <ol>
              <li v-for="event in orderObservationTimeline(lane.selected.events)" :key="event.eventId">
                <div><time>{{ clock(event.occurredAt) }}</time><span>{{ observationEventStage(event) }}</span></div>
                <p>{{ observationEventLabel(event) }}</p>
                <code v-if="event.orderId">订单 {{ event.orderId }}</code>
              </li>
            </ol>
          </details>
        </template>
        <p v-else class="diagnosis-progress__empty">此方向未提供执行记录，不能据此认定未下单。</p>
      </section>
    </div>
    <details v-if="orchestration.length" class="diagnosis-progress__orchestration">
      <summary>整单编排记录 <span>{{ orchestration.length }} 条</span></summary>
      <p v-for="event in orchestration" :key="event.eventId"><time>{{ clock(event.occurredAt) }}</time> {{ observationEventLabel(event) }}</p>
    </details>
    <p class="diagnosis-progress__note">提交阶段指已记录下注处理过程，不等于下单成功。仅预检记录未包含提交事件。{{ data.observation?.truncated ? '记录已截断，计数仅代表本次查询结果。' : '' }}缺少记录不代表未发生。</p>
  </section>
</template>

<style scoped>
.diagnosis-progress { --progress-success: #34d399; --progress-danger: #fb7185; --progress-warning: #fbbf24; --progress-pending: #93c5fd; margin-top: 18px; color: var(--adm-text); font-size: 12px; }
.diagnosis-progress__heading, .diagnosis-progress__leg-heading, .diagnosis-progress__timeline header { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
h4 { margin: 0; font-size: 16px; } p { margin: 5px 0; line-height: 1.6; } .diagnosis-progress__heading p, .diagnosis-progress__account, .diagnosis-progress__identity, .diagnosis-progress__empty, .diagnosis-progress__note { color: var(--adm-text-secondary); }
.diagnosis-progress__badge { padding: 4px 10px; border-radius: 20px; background: rgba(96, 165, 250, .1); color: #93c5fd; white-space: nowrap; }
.diagnosis-progress__counts { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 5px; } .diagnosis-progress__counts small { color: var(--adm-text-secondary); }
select { max-width: 100%; padding: 6px 8px; font: inherit; color: var(--adm-text); background: var(--adm-surface); border: 1px solid var(--adm-border); border-radius: 5px; }
.diagnosis-progress__history { width: 100%; margin-bottom: 6px; } .diagnosis-progress__check-summary { font-size: 11px; color: var(--progress-warning); }
.diagnosis-progress__executions, .diagnosis-progress__attempts { display: flex; flex-wrap: wrap; gap: 5px; margin: 10px 0; }
button { font: inherit; color: var(--adm-text-secondary); background: transparent; border: 1px solid var(--adm-border); border-radius: 5px; padding: 5px 9px; cursor: pointer; }
button[aria-pressed="true"] { color: #93c5fd; background: rgba(96, 165, 250, .12); border-color: rgba(96, 165, 250, .5); } button:hover { border-color: #93c5fd; }
button:focus-visible, summary:focus-visible { outline: 2px solid #93c5fd; outline-offset: 3px; } small { margin-left: 5px; }
code { font-size: 11px; overflow-wrap: anywhere; } .diagnosis-progress__identity { margin: 12px 0; } .diagnosis-progress__identity code { color: var(--adm-text); margin-left: 6px; }
.diagnosis-progress__scroll { overflow-x: auto; border: 1px solid var(--adm-border); border-radius: 8px; }
.diagnosis-progress__comparison { border-collapse: collapse; table-layout: fixed; width: 100%; min-width: 590px; }
th, td { padding: 12px; text-align: left; vertical-align: top; border-bottom: 1px solid var(--adm-border); overflow-wrap: anywhere; } th + th, td { border-left: 1px solid var(--adm-border); } tbody tr:last-child > * { border-bottom: 0; }
thead th { background: var(--adm-surface-2); font-weight: 400; } .diagnosis-progress__phase-column { width: 114px; } tbody th { font-weight: 500; color: var(--adm-text-secondary); font-size: 11px; }
.diagnosis-progress__comparison th:first-child { position: sticky; left: 0; z-index: 1; background: var(--adm-surface-2); } .diagnosis-progress__mobile-hint { display: none; color: var(--adm-text-secondary); font-size: 11px; }
.diagnosis-progress__leg-heading span { color: #93c5fd; font-weight: 600; } .diagnosis-progress__leg-heading strong { font-size: 14px; }
.diagnosis-progress__status { margin: 10px 0 5px; font-size: 15px; font-weight: 600; } .diagnosis-progress__attempt-id { display: block; color: var(--adm-text-secondary); font-size: 10px; font-weight: 400; }
.diagnosis-progress__result { display: flex; align-items: baseline; flex-wrap: wrap; gap: 5px; color: var(--adm-text-secondary); } .diagnosis-progress__result strong { font-weight: 600; } time { font-size: 10px; color: var(--adm-text-secondary); font-variant-numeric: tabular-nums; }
.diagnosis-progress__result time { margin-left: auto; } .diagnosis-progress__dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex-shrink: 0; align-self: center; }
[data-tone="success"] { color: var(--progress-success); } [data-tone="danger"] { color: var(--progress-danger); } [data-tone="warning"] { color: var(--progress-warning); } [data-tone="pending"] { color: var(--progress-pending); }
.diagnosis-progress__step { display: inline-grid; place-items: center; width: 19px; height: 19px; border: 1px solid var(--adm-border); border-radius: 50%; margin-right: 6px; }
.diagnosis-progress__quote { display: flex; gap: 5px 12px; flex-wrap: wrap; margin-top: 7px; font-size: 11px; } .diagnosis-progress__basis { color: var(--adm-text-secondary); font-size: 11px; }
.diagnosis-progress__timelines { display: grid; grid-template-columns: repeat(var(--diagnosis-lanes, 2), minmax(0, 1fr)); gap: 12px; margin: 12px 0; }
.diagnosis-progress__timeline { padding: 12px; border: 1px solid var(--adm-border); border-radius: 8px; min-width: 0; } .diagnosis-progress__timeline header span { color: var(--adm-text-secondary); font-size: 10px; }
.diagnosis-progress__issue { color: var(--progress-warning); font-size: 11px; } summary { cursor: pointer; padding: 8px 0; color: #93c5fd; }
ol { list-style: none; padding: 0; margin: 0; max-height: 260px; overflow: auto; } li { padding: 8px 0 8px 12px; margin-left: 3px; border-left: 1px solid var(--adm-border); position: relative; overflow-wrap: anywhere; } li::before { content: ''; position: absolute; left: -3px; top: 13px; width: 5px; height: 5px; border-radius: 50%; background: #93c5fd; } li div { display: flex; gap: 8px; color: #93c5fd; font-size: 10px; }
.diagnosis-progress__orchestration { border-top: 1px solid var(--adm-border); } .diagnosis-progress__orchestration span { color: var(--adm-text-secondary); margin-left: 8px; } .diagnosis-progress__note { font-size: 11px; margin: 8px 0 0; }
@media (max-width: 700px) { .diagnosis-progress__timelines { grid-template-columns: 1fr; } .diagnosis-progress__mobile-hint { display: block; } }
</style>
