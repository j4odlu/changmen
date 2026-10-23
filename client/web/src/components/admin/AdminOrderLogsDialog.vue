<script setup lang="ts">
import type { AdminOrderLogLookup, AdminOrderRow } from "@/types/admin";
import { formatLinkId } from "@changmen/client-core/shared/format";
import { observationEventLabel, observationEventStage } from "@changmen/shared/order_observation_view";
import { ElMessage } from "element-plus";
import { ref } from "vue";
import { getAdminOrderLogs } from "@/api/admin";
import AdminOrderExecutionRecords from "./AdminOrderExecutionRecords.vue";
import {
  fmtTime, fmtClock, fmtMoney, orderMoneyCny, orderStakeLabel, orderStakeCny,
  reduceEvents, kindClass, statusBadgeClass, pnlClass, logDetailParts,
  attemptDividerLabel, legOrderAttempts, legProfit,
} from "./adminOrderLogDisplay";
import { sideLabel, attemptProvider } from "./adminOrderLogGrouping";
import { useAdminOrderLogPresentation } from "./useAdminOrderLogPresentation";
import { adminObservationReport } from "@/shared/adminOrderObservation";
import { attemptLogSegments } from "@/shared/adminOrderLogSegments";

const visible = ref(false);
const loading = ref(false);
const error = ref("");
const data = ref<AdminOrderLogLookup | null>(null);
const {
  observationTimeline, directDiagnosis, frontendLogFilter, filteredLogs,
  legColumns, dialogWidth, legColumnsStyle, sortedOrders, overviewMatch,
  totalProfit, executionSteps, evidenceIssues, suggestedCheck, diagnosisSummary,
  orchestrationStages, platformLabels, logStats, hasOverviewOrders, fmtOrchestrationElapsed,
} = useAdminOrderLogPresentation(data, () => executionLookup.value);
const title = ref("下单诊断");
let requestSequence = 0;
const lookupRows = ref<AdminOrderRow[]>([]);
const expanded = ref(false);
const legacyDetailed = ref(false);

const kindLabel: Record<string, string> = {
  check: "预检",
  bet: "下注",
  reject: "拒单",
  makeup_queue: "补单入队",
  makeup_cancel: "补单取消",
  other: "其他",
};

const executionLookup = ref<{ userId: string; linkId?: number; executionId?: string; attemptId?: string; eventId?: string } | null>(null);

async function openExecution(input: NonNullable<typeof executionLookup.value>) {
  executionLookup.value = { ...input };
  lookupRows.value = [];
  expanded.value = false;
  legacyDetailed.value = false;
  await loadDiagnosis();
}

async function open(rows: AdminOrderRow[]) {
  if (!rows.length)
    return;
  executionLookup.value = null;
  lookupRows.value = [...rows];
  expanded.value = false;
  legacyDetailed.value = false;
  await loadDiagnosis();
}

async function loadDiagnosis() {
  const rows = lookupRows.value;
  if (!rows.length && !executionLookup.value)
    return;
  const sequence = ++requestSequence;
  const head = rows[0]!;
  visible.value = true;
  loading.value = true;
  error.value = "";
  data.value = null;
  title.value = head ? `下单诊断 · ${formatLinkId(head.linkId)}` : "执行诊断（包含无落库订单）";
  try {
    const payload = await getAdminOrderLogs({ ...(executionLookup.value || {
      userId: head.userId,
      linkId: head.linkId || undefined,
      orderId: !head.linkId ? head.orderId : undefined,
      domain: head.domain,
      sport: head.sport,
      venue: head.provider,
      paddingMs: expanded.value ? 1_800_000 : undefined,
      logLimit: expanded.value ? 5000 : undefined,
    }), preferDirect: !legacyDetailed.value });
    if (sequence === requestSequence)
      data.value = payload;
  }
  catch (e) {
    if (sequence !== requestSequence)
      return;
    error.value = (e as Error).message || "加载失败";
    ElMessage.error(error.value);
  }
  finally {
    if (sequence === requestSequence)
      loading.value = false;
  }
}

function close() {
  ++requestSequence;
  loading.value = false;
  visible.value = false;
}

async function expandLookup() {
  expanded.value = legacyDetailed.value || data.value?.legacyLogsLoaded === true;
  legacyDetailed.value = true;
  await loadDiagnosis();
}

async function copyReport() {
  if (!data.value)
    return;
  // [changmen 扩展] 仅复制摘要及核查提示，不导出账号凭证和接口原始请求。
  const report = directDiagnosis.value ? adminObservationReport(data.value) : [
    `下单诊断 · ${formatLinkId(data.value.link)}`,
    diagnosisSummary.value.text,
    `证据：${evidenceIssues.value.join("；") || "现有执行证据覆盖完整"}`,
    ...orchestrationStages.value.map(stage => `${stage.title}：${stage.decision}`),
  ].join("\n");
  try {
    await navigator.clipboard.writeText(report);
    ElMessage.success("诊断摘要已复制");
  }
  catch {
    ElMessage.error("复制失败，请检查浏览器剪贴板权限");
  }
}

defineExpose({ open, openExecution });
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="title"
    :width="dialogWidth"
    class="admin-order-log-dialog admin-dialog"
    append-to-body
    destroy-on-close
    @close="close"
  >
    <div v-loading="loading" class="admin-order-log-dialog__scroll">
      <div class="admin-order-log-dialog__body">
        <p v-if="error" class="admin-order-log-dialog__err">
          {{ error }}
        </p>
        <template v-else-if="data">
          <div class="admin-order-log-layout">
            <section class="admin-order-log-overview">
              <div class="admin-order-log-overview__head">
                <div class="admin-order-log-overview__primary">
                  <span class="admin-order-log-overview__user">{{ data.user.userName }}</span>
                  <span class="admin-order-log-overview__link">{{ formatLinkId(data.link) }}</span>
                  <span class="admin-order-log-overview__tag">{{ data.linkType }}</span>
                  <span class="admin-order-log-overview__tag admin-order-log-overview__tag--muted">{{
                    data.groupLabel
                  }}</span>
                </div>
                <div class="admin-order-log-overview__window">
                  {{ directDiagnosis ? '执行记录时间' : '日志窗口' }} {{ fmtTime(data.logWindow.fromMs) }} — {{ fmtTime(data.logWindow.toMs) }}
                </div>
              </div>

              <div class="admin-order-log-overview__stats">
                <div class="admin-order-log-stat">
                  <span class="admin-order-log-stat__label">平台</span>
                  <span class="admin-order-log-stat__value">{{ platformLabels || "—" }}</span>
                </div>
                <div class="admin-order-log-stat">
                  <span class="admin-order-log-stat__label">订单</span>
                  <span class="admin-order-log-stat__value">{{ data.ordersQueried === false ? '本次未查询' : `${sortedOrders.length} 笔` }}</span>
                </div>
                <div class="admin-order-log-stat">
                  <span class="admin-order-log-stat__label">日志</span>
                  <span class="admin-order-log-stat__value">
                    <template v-if="data.legacyLogsLoaded === false">旧日志未查询 · 执行 {{ data.observation?.events.length || 0 }} 条</template>
                    <template v-else>{{ logStats.related }} / {{ logStats.total }} 条相关</template>
                  </span>
                </div>
                <div
                  class="admin-order-log-stat"
                  :class="{ 'admin-order-log-stat--warn': evidenceIssues.length > 0 }"
                >
                  <span class="admin-order-log-stat__label">诊断质量</span>
                  <span class="admin-order-log-stat__value">
                    <template v-if="directDiagnosis && data.observation?.truncated">执行记录已截断</template>
                    <template v-else-if="logStats.truncated">
                      日志已截断 {{ logStats.limit }} 条
                    </template>
                    <template v-else-if="evidenceIssues.length">
                      证据不完整
                    </template>
                    <template v-else>
                      {{ directDiagnosis ? '直接记录可用' : '执行证据覆盖完整' }}
                    </template>
                  </span>
                </div>
                <div v-if="overviewMatch" class="admin-order-log-stat admin-order-log-stat--wide">
                  <span class="admin-order-log-stat__label">比赛</span>
                  <span class="admin-order-log-stat__value">{{ overviewMatch }}</span>
                </div>
                <div
                  v-if="sortedOrders.length"
                  class="admin-order-log-stat"
                  :class="{
                    'admin-order-log-stat--pnl-pos': totalProfit > 0,
                    'admin-order-log-stat--pnl-neg': totalProfit < 0,
                  }"
                >
                  <span class="admin-order-log-stat__label">Link 盈亏</span>
                  <span class="admin-order-log-stat__value">¥{{ fmtMoney(totalProfit) }}</span>
                </div>
              </div>

              <details v-if="directDiagnosis && evidenceIssues.length" class="admin-order-log-issues">
                <summary>{{ evidenceIssues.length }} 项核查提示 · 展开查看</summary>
                <ul><li v-for="issue in evidenceIssues" :key="issue">{{ issue }}</li></ul>
              </details>
              <el-alert v-else-if="evidenceIssues.length" type="warning" :closable="false" :title="evidenceIssues.join('；')" />
              <p v-if="!directDiagnosis" class="admin-order-log-overview__window">
                建议核查：{{ suggestedCheck }}
              </p>
              <p v-if="!directDiagnosis" class="admin-order-log-overview__window">
                明确 Link／订单 ID 的日志跨时间窗检索；时间窗用于旧日志关联。流程和金额公式包含推断，须结合技术明细核对。
              </p>
              <AdminOrderExecutionRecords v-if="directDiagnosis" :data="data" />

              <section
                v-if="executionSteps.length && !directDiagnosis"
                class="admin-order-diagnosis"
                :class="`admin-order-diagnosis--${diagnosisSummary.tone}`"
              >
                <header class="admin-order-diagnosis__head">
                  <div>
                    <h5 class="admin-order-diagnosis__title">
                      编排诊断（日志与规则重建）
                    </h5>
                    <p class="admin-order-diagnosis__summary">
                      {{ diagnosisSummary.text }}
                    </p>
                  </div>
                  <span class="admin-order-diagnosis__count">
                    {{ orchestrationStages.length }} 个编排阶段
                  </span>
                </header>

                <ol class="admin-order-execution admin-order-orchestration">
                  <li
                    v-for="(stage, stageIdx) in orchestrationStages"
                    :key="stage.key"
                    class="admin-order-execution__step"
                    :class="`admin-order-execution__step--${stage.tone}`"
                  >
                    <div class="admin-order-orchestration__time">
                      <strong>{{ fmtClock(stage.at) }}</strong>
                      <span>{{ fmtOrchestrationElapsed(stage.at) }}</span>
                    </div>
                    <div class="admin-order-execution__body admin-order-orchestration__center">
                      <div class="admin-order-execution__main">
                        <span class="admin-order-execution__index">{{ stageIdx + 1 }}</span>
                        <strong class="admin-order-execution__outcome">{{ stage.title }}</strong>
                      </div>
                      <div class="admin-order-execution__logic">
                        <p>
                          <span>编排判断</span>
                          {{ stage.decision }}
                        </p>
                        <p>
                          <span>编排动作</span>
                          {{ stage.action }}
                        </p>
                      </div>
                      <ul v-if="!stage.homeNodes.length && !stage.awayNodes.length" class="admin-order-orchestration__evidence">
                        <li v-for="item in stage.evidence" :key="item">
                          {{ item }}
                        </li>
                      </ul>
                    </div>
                    <div
                      v-if="stage.homeNodes.length || stage.awayNodes.length"
                      class="admin-order-orchestration__lanes"
                    >
                      <div class="admin-order-orchestration__lane admin-order-orchestration__lane--home">
                        <div class="admin-order-orchestration__lane-title">
                          主队腿 Home
                        </div>
                        <article
                          v-for="node in stage.homeNodes"
                          :key="node.key"
                          class="admin-order-orchestration__node"
                          :class="`admin-order-orchestration__node--${node.tone}`"
                        >
                          <header>
                            <strong>{{ node.title }}</strong>
                            <span>{{ node.provider }}</span>
                          </header>
                          <p>{{ node.summary }}</p>
                          <small>{{ fmtClock(node.at) }}<template v-if="node.detail"> · {{ node.detail }}</template></small>
                        </article>
                        <span v-if="!stage.homeNodes.length" class="admin-order-orchestration__empty">本阶段无主队腿动作</span>
                      </div>
                      <div class="admin-order-orchestration__lane admin-order-orchestration__lane--away">
                        <div class="admin-order-orchestration__lane-title">
                          客队腿 Away
                        </div>
                        <article
                          v-for="node in stage.awayNodes"
                          :key="node.key"
                          class="admin-order-orchestration__node"
                          :class="`admin-order-orchestration__node--${node.tone}`"
                        >
                          <header>
                            <strong>{{ node.title }}</strong>
                            <span>{{ node.provider }}</span>
                          </header>
                          <p>{{ node.summary }}</p>
                          <small>{{ fmtClock(node.at) }}<template v-if="node.detail"> · {{ node.detail }}</template></small>
                        </article>
                        <span v-if="!stage.awayNodes.length" class="admin-order-orchestration__empty">本阶段无客队腿动作</span>
                      </div>
                    </div>
                  </li>
                </ol>
              </section>

              <div v-if="legColumns.length && !directDiagnosis" class="admin-order-log-overview__orders">
                <h5 class="admin-order-log-overview__orders-title">
                  订单概况
                </h5>
                <div class="admin-order-log-platforms" :style="legColumnsStyle">
                  <section
                    v-for="leg in legColumns"
                    :key="`overview-${leg.key}`"
                    class="admin-order-log-platform-col admin-order-log-overview-leg"
                  >
                    <header class="admin-order-log-leg-col__head">
                      <span class="admin-order-log-leg-col__name">{{ sideLabel(leg) }}</span>
                      <span
                        v-if="legOrderAttempts(leg).length"
                        class="admin-order-log-overview-leg__pnl"
                        :class="{
                          pos: legProfit(leg) > 0,
                          neg: legProfit(leg) < 0,
                        }"
                      >
                        盈亏 ¥{{ fmtMoney(legProfit(leg)) }}
                      </span>
                    </header>

                    <template v-if="legOrderAttempts(leg).length">
                      <div
                        v-for="(attempt, attemptIdx) in legOrderAttempts(leg)"
                        :key="`overview-${attempt.key}`"
                        class="admin-order-log-overview-order"
                      >
                        <div
                          v-if="attemptIdx > 0"
                          class="admin-order-log-attempt-divider"
                          :data-label="
                            attemptDividerLabel(legOrderAttempts(leg)[attemptIdx - 1]!, attempt)
                          "
                        />

                        <div class="admin-order-log-overview-order__row">
                          <span class="admin-order-log-attempt__index">第 {{ attemptIdx + 1 }} 笔</span>
                          <span
                            class="admin-badge"
                            :class="statusBadgeClass(attempt.order!.status)"
                          >
                            {{ attempt.order!.status }}
                          </span>
                          <span v-if="attempt.order!.provider" class="admin-order-provider">{{
                            attempt.order!.provider
                          }}</span>
                        </div>
                        <div
                          v-if="attempt.order!.match"
                          class="admin-order-log-overview-order__match"
                        >
                          {{ attempt.order!.match }}
                        </div>
                        <div class="admin-order-log-overview-order__bet">
                          {{ attempt.order!.item || attempt.order!.bet }} @ {{ attempt.order!.odds }}
                        </div>
                        <div class="admin-order-log-overview-order__meta">
                          <span>{{ orderStakeLabel(attempt.order!) }} ¥{{ fmtMoney(orderStakeCny(attempt.order!)) }}</span>
                          <span
                            :class="pnlClass(orderMoneyCny(attempt.order!))"
                          >
                            {{
                              orderMoneyCny(attempt.order!)
                                ? `盈亏 ¥${fmtMoney(orderMoneyCny(attempt.order!))}`
                                : "—"
                            }}
                          </span>
                          <span class="admin-order-log-order-col__oid">#{{ attempt.order!.orderId }}</span>
                          <span class="admin-order-log-overview-order__time">{{
                            fmtTime(attempt.order!.createAt)
                          }}</span>
                        </div>
                        <ul
                          v-if="reduceEvents(attempt.order!).length"
                          class="admin-order-log-reduce-events"
                        >
                          <li
                            v-for="ev in reduceEvents(attempt.order!)"
                            :key="ev.id"
                          >
                            减仓 #{{ ev.id.slice(0, 10) }}
                            <template v-if="ev.shares != null">
                              · {{ ev.shares }} 份
                            </template>
                            <template v-if="ev.proceeds != null">
                              · 回款 {{ ev.proceeds }}
                            </template>
                          </li>
                        </ul>
                      </div>
                    </template>
                    <p v-else class="admin-order-log-overview__empty">
                      {{ sideLabel(leg) }}无落库订单
                    </p>
                  </section>
                </div>
              </div>
              <p v-else-if="!hasOverviewOrders && !directDiagnosis" class="admin-order-log-overview__empty">
                {{ data.ordersQueried === false ? '本次未查询当前订单' : '本次未查询到落库订单' }}
              </p>
            </section>

            <details v-if="data.observation && !directDiagnosis" class="admin-order-log-technical">
              <summary class="admin-order-log-technical__summary">
                原始执行时间线 · {{ data.observation.events.length }} 条事件
              </summary>
              <p>事件来自客户端上报，尚未独立核验场馆；此结果仅供核查，不参与下注或补单。</p>
              <el-alert v-for="issue in data.observation.issues" :key="issue" :title="issue" type="warning" :closable="false" />
              <ul class="admin-order-log-list">
                <li v-for="event in observationTimeline" :key="event.eventId" class="admin-order-log-list__row">
                  <span>{{ observationEventStage(event) }} · {{ event.provider || '系统' }} {{ event.target || '' }}</span>
                  <span>{{ observationEventLabel(event) }}</span>
                  <small>账号 {{ event.accountId || '—' }} · 订单 {{ event.orderId || '—' }}</small>
                  <small>发生 {{ fmtTime(event.occurredAt) }} · 接收 {{ fmtTime(event.receivedAt || 0) }}</small>
                  <small v-if="event.executionId">执行 {{ event.executionId }} · 父尝试 {{ event.parentAttemptId || '—' }}</small>
                  <small>事件 {{ event.eventId }} · 尝试 {{ event.attemptId || '—' }} · 队列 {{ event.queueId || '—' }}</small>
                </li>
              </ul>
            </details>

            <details class="admin-order-log-technical">
              <summary class="admin-order-log-technical__summary">
                <span>查看技术明细</span>
                <small>
                  {{ frontendLogFilter.related.length }} 条当前 Link 日志
                  <template v-if="filteredLogs.length"> · {{ filteredLogs.length }} 条已排除</template>
                </small>
              </summary>
              <p v-if="data.legacyLogsLoaded === false">当前使用直接执行记录；旧日志尚未查询，可通过底部“补查旧日志”加载。</p>

              <section class="admin-order-log-logs-row">
                <header class="admin-order-log-logs-row__head">
                  <h4 class="admin-order-log-logs-row__title">
                    原始诊断日志
                  </h4>
                  <span class="admin-order-log-logs-row__hint">
                    按主客队保留预检与接口原文，用于核对上方执行链
                  </span>
                </header>

                <div
                  v-if="legColumns.length"
                  class="admin-order-log-platforms"
                  :style="legColumnsStyle"
                >
                  <section
                    v-for="leg in legColumns"
                    :key="leg.key"
                    class="admin-order-log-platform-col admin-order-log-leg-col"
                  >
                    <header class="admin-order-log-leg-col__head">
                      <span class="admin-order-log-leg-col__name">{{ sideLabel(leg) }}</span>
                      <span class="admin-order-log-platform-col__counts">
                        {{ leg.attempts.length }} 段 ·
                        {{ leg.attempts.reduce((n, a) => n + a.logs.length, 0) }} 条日志
                      </span>
                    </header>

                    <template v-if="leg.attempts.length">
                      <div
                        v-for="(attempt, attemptIdx) in leg.attempts"
                        :key="attempt.key"
                        class="admin-order-log-attempt"
                      >
                        <div
                          v-if="attemptIdx > 0"
                          class="admin-order-log-attempt-divider"
                          :data-label="attemptDividerLabel(leg.attempts[attemptIdx - 1]!, attempt)"
                        />

                        <div class="admin-order-log-attempt__head">
                          <div class="admin-order-log-order-col__title">
                            <span v-if="attempt.order" class="admin-order-log-attempt__index">
                              第 {{ attemptIdx + 1 }} 笔
                            </span>
                            <span
                              v-if="attempt.order"
                              class="admin-badge admin-order-log-order-col__status"
                              :class="statusBadgeClass(attempt.order.status)"
                            >
                              {{ attempt.order.status }}
                            </span>
                            <span v-else class="admin-order-log-order-col__pending">未成单</span>
                            <span v-if="attemptProvider(attempt)" class="admin-order-provider">{{
                              attemptProvider(attempt)
                            }}</span>
                          </div>
                          <div v-if="attempt.order" class="admin-order-log-order-col__meta">
                            <span>{{ attempt.order.item || attempt.order.bet }} @ {{ attempt.order.odds }}</span>
                            <span>{{ orderStakeLabel(attempt.order) }} ¥{{ fmtMoney(orderStakeCny(attempt.order)) }}</span>
                            <span class="admin-order-log-order-col__oid">#{{ attempt.order.orderId }}</span>
                          </div>
                          <p
                            v-else
                            class="admin-order-log-order-col__meta admin-order-log-order-col__meta--muted"
                          >
                            仅有下注尝试日志，未落库 orders
                          </p>
                        </div>

                        <p
                          v-if="!attempt.logs.length"
                          class="admin-order-log-dialog__empty admin-order-log-platform-col__empty"
                        >
                          无 Client_SaveUserLog
                        </p>
                        <template v-else>
                          <div
                            v-for="(seg, segIdx) in attemptLogSegments(attempt)"
                            :key="`${attempt.key}-${seg.key}`"
                            class="admin-order-log-segment"
                          >
                            <header
                              v-if="seg.accountLabel || seg.isMakeUp"
                              class="admin-order-log-segment__head"
                            >
                              <span v-if="seg.accountLabel" class="admin-order-log-segment__account">{{
                                seg.accountLabel
                              }}</span>
                              <span v-if="seg.isMakeUp" class="admin-order-log-segment__tag">补单轮次</span>
                              <span
                                v-if="attemptLogSegments(attempt).length > 1"
                                class="admin-order-log-segment__round"
                              >
                                轮次 {{ segIdx + 1 }}/{{ attemptLogSegments(attempt).length }}
                              </span>
                            </header>
                            <ul class="admin-order-log-list">
                              <li
                                v-for="(log, i) in seg.logs"
                                :key="log.id ?? `${seg.key}-${i}`"
                                class="admin-order-log-list__row"
                              >
                                <span class="admin-order-log-list__time">{{ fmtTime(log.createAt) }}</span>
                                <span class="admin-order-log-kind" :class="kindClass(log.kind)">{{
                                  kindLabel[log.kind] || log.kind
                                }}</span>
                                <span class="admin-order-log-list__summary" :title="log.summary">{{
                                  log.summary
                                }}</span>
                                <div
                                  v-if="logDetailParts(log).length"
                                  class="admin-order-log-list__details"
                                >
                                  <span
                                    v-for="part in logDetailParts(log)"
                                    :key="part"
                                    class="admin-order-log-list__detail"
                                  >
                                    {{ part }}
                                  </span>
                                </div>
                              </li>
                            </ul>
                          </div>
                        </template>
                      </div>
                    </template>
                    <p v-else class="admin-order-log-dialog__empty admin-order-log-platform-col__empty">
                      {{ sideLabel(leg) }}无订单与日志
                    </p>
                  </section>
                </div>
                <p v-else class="admin-order-log-dialog__empty">
                  该时间窗内无 Client_SaveUserLog 记录
                </p>
              </section>

              <section
                v-if="filteredLogs.length"
                class="admin-order-log-filtered"
              >
                <header class="admin-order-log-filtered__head">
                  <h4 class="admin-order-log-logs-row__title">
                    已过滤的窗口日志
                  </h4>
                  <span class="admin-order-log-logs-row__hint">
                    这些日志在时间窗内，但未匹配当前订单，通常是其他比赛或账号刷新日志
                  </span>
                </header>
                <ul class="admin-order-log-list admin-order-log-list--filtered">
                  <li
                    v-for="(log, i) in filteredLogs.slice(0, 8)"
                    :key="log.id ?? `filtered-${i}`"
                    class="admin-order-log-list__row admin-order-log-list__row--filtered"
                  >
                    <span class="admin-order-log-list__time">{{ fmtTime(log.createAt) }}</span>
                    <span class="admin-order-log-kind" :class="kindClass(log.kind)">
                      {{ kindLabel[log.kind] || log.kind }}
                    </span>
                    <span class="admin-order-log-list__summary" :title="log.summary">
                      {{ log.summary }}
                    </span>
                    <div class="admin-order-log-list__details">
                      <span class="admin-order-log-list__detail">
                        {{ log.relationReason || "未匹配当前订单" }}
                      </span>
                    </div>
                  </li>
                </ul>
                <p
                  v-if="filteredLogs.length > 8"
                  class="admin-order-log-filtered__more"
                >
                  还有 {{ filteredLogs.length - 8 }} 条已过滤日志未展开
                </p>
              </section>
            </details>
          </div>
        </template>
      </div>
    </div>
    <template #footer>
      <el-button :disabled="loading || !data" @click="copyReport">
        复制诊断摘要
      </el-button>
      <el-button :disabled="loading || !lookupRows.length" @click="expandLookup">
        {{ data?.legacyLogsLoaded === false ? '补查旧日志' : '扩大旧日志窗口至前后30分钟' }}
      </el-button>
      <el-button :loading="loading" @click="loadDiagnosis">
        {{ error ? "重试" : "刷新" }}
      </el-button>
      <el-button @click="close">
        关闭
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
:global(.admin-order-log-dialog .el-dialog__body) { display: flex; flex-direction: column; }
.admin-order-log-dialog__scroll { flex: 1; min-height: 0; max-height: none; }
.admin-order-log-issues { padding: 8px 12px; margin-top: 10px; background: rgba(251, 191, 36, .06); border: 1px solid rgba(251, 191, 36, .2); border-radius: 6px; color: #fbbf24; font-size: 12px; }
.admin-order-log-issues summary { cursor: pointer; }
.admin-order-log-issues ul { margin: 8px 0 0; padding-left: 18px; line-height: 1.8; }
@media (max-width: 700px) {
  :global(.admin-order-log-dialog .el-dialog__body) { padding: 10px 12px; }
  :global(.admin-order-log-dialog .el-dialog__footer) { display: flex; flex-wrap: wrap; gap: 6px; }
  :global(.admin-order-log-dialog .el-dialog__footer .el-button) { margin: 0; flex: 1 1 calc(50% - 6px); }
  .admin-order-log-overview { padding: 10px; }
  .admin-order-log-overview__stats { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
}
</style>
