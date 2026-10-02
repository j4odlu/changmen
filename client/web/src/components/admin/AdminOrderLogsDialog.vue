<script setup lang="ts">
import type {
  AdminOrderLogAttempt,
  AdminOrderLogEntry,
  AdminOrderLogLegSection,
  AdminOrderLogLookup,
  AdminOrderRow,
} from "@/types/admin";
import { formatLinkId } from "@changmen/client-core/shared/format";
import { observationEventLabel, observationEventStage, orderObservationTimeline } from "@changmen/shared/order_observation_view";
import { ElMessage } from "element-plus";
import { computed, ref } from "vue";
import { getAdminOrderLogs } from "@/api/admin";
import {
  adminOrderEvidenceIssues,
  buildAdminOrderDiagnosisSummary,
  buildAdminOrderExecutionSteps,
  buildAdminOrderOrchestrationStages,
  filterAdminOrderDiagnosisLogs,
} from "@/shared/adminOrderDiagnosis";
import { attemptLogSegments, filterBackendLegSections } from "@/shared/adminOrderLogSegments";
import { adminOrderBetMoneyCny, adminOrderMoneyCny, isAdminPredictionSell, sumAdminOrdersMoneyCny } from "@/shared/adminOrderMoney";

const ARB_LINK_MIN = 1_000_000_000_000;

const visible = ref(false);
const loading = ref(false);
const error = ref("");
const data = ref<AdminOrderLogLookup | null>(null);
const observationTimeline = computed(() => orderObservationTimeline(data.value?.observation?.events || []));
const title = ref("下单诊断");
let requestSequence = 0;
const lookupRows = ref<AdminOrderRow[]>([]);
const expanded = ref(false);

const kindLabel: Record<string, string> = {
  check: "预检",
  bet: "下注",
  reject: "拒单",
  makeup_queue: "补单入队",
  makeup_cancel: "补单取消",
  other: "其他",
};
function fmtTime(ts: number) {
  if (!ts)
    return "—";
  return new Date(ts).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
}

function fmtClock(ts: number) {
  if (!ts)
    return "—";
  return new Date(ts).toLocaleTimeString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
}

function fmtMoney(n: number) {
  return Math.floor(n).toLocaleString();
}

function orderMoneyCny(order: NonNullable<AdminOrderLogAttempt["order"]>) {
  return adminOrderMoneyCny({
    provider: order.provider,
    money: order.money,
    pfSide: order.pfSide,
    pmSide: order.pmSide,
  });
}

function orderStakeLabel(order: NonNullable<AdminOrderLogAttempt["order"]>) {
  return isAdminPredictionSell(order) ? "回款" : "金额";
}

function orderStakeCny(order: NonNullable<AdminOrderLogAttempt["order"]>) {
  return adminOrderBetMoneyCny({
    provider: order.provider,
    betMoney: order.betMoney,
    pfSide: order.pfSide,
    pmSide: order.pmSide,
  });
}

function reduceEvents(order: NonNullable<AdminOrderLogAttempt["order"]>) {
  const sells = order.positionEvents?.sells;
  return Array.isArray(sells) ? sells : [];
}

function fmtMaybeNumber(n: number | null | undefined) {
  if (n === null || n === undefined || Number.isNaN(Number(n)))
    return "";
  return String(n);
}

function kindClass(kind: string) {
  if (kind === "bet")
    return "admin-order-log-kind--bet";
  if (kind === "check")
    return "admin-order-log-kind--check";
  if (kind === "reject")
    return "admin-order-log-kind--reject";
  return "";
}

function statusBadgeClass(status: string) {
  const s = status.toLowerCase();
  if (s === "win")
    return "admin-badge--win";
  if (s === "lose")
    return "admin-badge--lose";
  if (s === "reject")
    return "admin-badge--reject";
  if (s === "pending")
    return "admin-badge--pending";
  return "";
}

function pnlClass(money: number) {
  if (money > 0)
    return "pos";
  if (money < 0)
    return "neg";
  return "";
}

function isArbLookup(payload: AdminOrderLogLookup) {
  if (payload.linkType === "套利" || payload.groupLabel.includes("套利"))
    return true;
  const orders = payload.orders || [];
  return orders.length > 1 && orders.every(o => Number(o.link) >= ARB_LINK_MIN);
}

function assignOrphanLogs(attempts: AdminOrderLogAttempt[], orphanLogs: AdminOrderLogEntry[]) {
  if (!orphanLogs.length)
    return;
  if (!attempts.length) {
    attempts.push({ key: "orphan", order: null, logs: [...orphanLogs] });
    return;
  }
  for (const log of orphanLogs) {
    let best = attempts[0]!;
    let bestDist = Math.abs(log.createAt - (best.order?.createAt ?? log.createAt));
    for (const att of attempts.slice(1)) {
      const dist = Math.abs(log.createAt - (att.order?.createAt ?? 0));
      if (dist < bestDist) {
        bestDist = dist;
        best = att;
      }
    }
    best.logs.push(log);
  }
}

function inferTargetFromLogs(logs: AdminOrderLogEntry[]) {
  for (const log of logs) {
    if (log.target === "Home" || log.target === "Away")
      return log.target;
  }
  for (const log of logs) {
    const m = String(log.summary || "").match(/\s(Home|Away)@/);
    if (m)
      return m[1] as "Home" | "Away";
  }
  return null;
}

function sideLabel(leg: AdminOrderLogLegSection) {
  return leg.side === "Away" ? "客队" : "主队";
}

function attemptProvider(attempt: AdminOrderLogAttempt) {
  return attempt.order?.provider ?? null;
}

function touchLegProvider(leg: AdminOrderLogLegSection, provider: string | null | undefined) {
  if (!provider)
    return;
  if (!leg.provider) {
    leg.provider = provider;
    return;
  }
  if (leg.provider.includes(provider))
    return;
  leg.provider = `${leg.provider}/${provider}`;
}

function pickLegIndexForUnassigned(legs: AdminOrderLogLegSection[]) {
  const homeN = legs[0]!.attempts.length;
  const awayN = legs[1]!.attempts.length;
  if (homeN && !awayN)
    return 1;
  if (!homeN && awayN)
    return 0;
  return homeN <= awayN ? 0 : 1;
}

function resolveLegIndexByProvider(provider: string | null | undefined, legs: AdminOrderLogLegSection[]) {
  if (!provider)
    return pickLegIndexForUnassigned(legs);
  for (let i = 0; i < 2; i++) {
    if (legs[i]!.provider === provider || legs[i]!.provider?.includes(provider))
      return i;
    for (const att of legs[i]!.attempts) {
      if (att.order?.provider === provider)
        return i;
    }
  }
  return pickLegIndexForUnassigned(legs);
}

/** 旧后端无 legSections 时前端兜底（主客队） */
function fallbackLegSections(payload: AdminOrderLogLookup): AdminOrderLogLegSection[] {
  const sortedOrders = [...payload.orders].sort((a, b) => a.createAt - b.createAt);
  const sortedLogs = [...payload.logs].sort((a, b) => a.createAt - b.createAt);
  const isArb = isArbLookup(payload);

  const legs: AdminOrderLogLegSection[] = [
    { key: "leg-home", legIndex: 0, side: "Home", label: "主队", provider: null, attempts: [] },
    { key: "leg-away", legIndex: 1, side: "Away", label: "客队", provider: null, attempts: [] },
  ];

  const attempts = sortedOrders.map(order => ({
    key: order.orderId,
    order,
    logs: [] as AdminOrderLogEntry[],
  }));
  const attemptByOrderId = new Map(attempts.map(a => [a.order.orderId, a]));
  const orphanLogs: AdminOrderLogEntry[] = [];

  for (const log of sortedLogs) {
    const orderId = log.orderId ? String(log.orderId) : null;
    if (orderId && attemptByOrderId.has(orderId)) {
      attemptByOrderId.get(orderId)!.logs.push(log);
    }
    else {
      orphanLogs.push(log);
    }
  }

  for (const att of attempts) {
    att.logs.sort((a, b) => a.createAt - b.createAt);
    const side = inferTargetFromLogs(att.logs);
    const legIdx
      = side === "Away" ? 1 : side === "Home" ? 0 : pickLegIndexForUnassigned(legs);
    legs[legIdx]!.attempts.push(att);
    touchLegProvider(legs[legIdx]!, att.order.provider);
  }

  for (const leg of legs) {
    leg.attempts.sort((a, b) => (a.order?.createAt ?? 0) - (b.order?.createAt ?? 0));
  }

  const orphanBySide: { Home: AdminOrderLogEntry[]; Away: AdminOrderLogEntry[]; unknown: AdminOrderLogEntry[] } = {
    Home: [],
    Away: [],
    unknown: [],
  };
  for (const log of orphanLogs) {
    const side
      = log.target === "Home" || log.target === "Away"
        ? log.target
        : (String(log.summary || "").match(/\s(Home|Away)@/)?.[1] as "Home" | "Away" | undefined);
    if (side === "Home")
      orphanBySide.Home.push(log);
    else if (side === "Away")
      orphanBySide.Away.push(log);
    else orphanBySide.unknown.push(log);
  }

  assignOrphanLogs(legs[0]!.attempts, orphanBySide.Home);
  assignOrphanLogs(legs[1]!.attempts, orphanBySide.Away);
  for (const log of orphanBySide.unknown) {
    const idx = resolveLegIndexByProvider(log.provider, legs);
    assignOrphanLogs(legs[idx]!.attempts, [log]);
    touchLegProvider(legs[idx]!, log.provider);
  }

  for (const leg of legs) {
    leg.label = sideLabel(leg);
  }

  if (isArb)
    return legs;
  return legs.filter(leg => leg.attempts.some(a => a.order || a.logs.length > 0));
}

const frontendLogFilter = computed(() => {
  if (!data.value)
    return { related: [] as AdminOrderLogEntry[], filtered: [] as AdminOrderLogEntry[] };
  return filterAdminOrderDiagnosisLogs(data.value);
});

const filteredLogs = computed(() => {
  const merged = [
    ...frontendLogFilter.value.filtered,
    ...(data.value?.unrelatedLogs ?? []),
  ];
  const seen = new Set<string>();
  return merged.filter((log) => {
    const key = String(log.id ?? `${log.createAt}:${log.title}:${log.summary}`);
    if (seen.has(key))
      return false;
    seen.add(key);
    return true;
  });
});

const legColumns = computed(() => {
  if (!data.value)
    return [];
  // 新后端已按 linkId/orderId/时序完成精确关联；前端只做安全过滤，避免把
  // 没有 target 的下注结果重新猜到另一条腿。旧后端无 legSections 才兜底重建。
  const backendLegs = filterBackendLegSections(
    data.value.legSections,
    frontendLogFilter.value.related,
  );
  if (backendLegs)
    return backendLegs;
  return fallbackLegSections({
    ...data.value,
    logs: frontendLogFilter.value.related,
  });
});

const dialogWidth = computed(() => {
  const n = legColumns.value.length;
  if (n <= 2)
    return "min(980px, 98vw)";
  return `min(${720 + n * 240}px, 98vw)`;
});

const legColumnsStyle = computed(() => ({
  "--order-log-cols": String(Math.max(legColumns.value.length, 1)),
}));

const sortedOrders = computed(() => {
  if (!data.value?.orders.length)
    return [];
  return [...data.value.orders].sort((a, b) => a.createAt - b.createAt);
});

const overviewMatch = computed(() => {
  const matches = sortedOrders.value.map(o => o.match).filter(Boolean);
  if (!matches.length)
    return "";
  const first = matches[0];
  return matches.every(m => m === first) ? first : matches[0];
});

const totalProfit = computed(() =>
  sumAdminOrdersMoneyCny(sortedOrders.value),
);

const executionSteps = computed(() => buildAdminOrderExecutionSteps(legColumns.value));
const diagnosisContext = computed(() => ({ linkType: data.value?.linkType, truncated: data.value?.logStats?.truncated }));
const evidenceIssues = computed(() => adminOrderEvidenceIssues(executionSteps.value, diagnosisContext.value));
const suggestedCheck = computed(() => {
  if (executionLookup.value && !data.value?.orders.length)
    return "核查执行时间线中的失败、确认、绑定及缺口事件；缺少落库证据不能证明未成交。";
  if (data.value?.logStats?.truncated)
    return "扩大日志查询后重新诊断；当前日志已截断，后续动作可能缺失。";
  if (evidenceIssues.value.length)
    return "核对场馆订单状态，并补查缺失日志；当前证据不足以确认完整执行结果。";
  if (executionSteps.value.some(step => step.bet?.success === false || step.rejectLogic || step.check?.checkError))
    return "核对失败或拒单原因，以及重试、补单后的场馆订单，确认是否仍存在单腿敞口。";
  return "现有证据已覆盖执行过程；比赛未结算前，盈亏以当前记录为准。";
});
const diagnosisSummary = computed(() => executionLookup.value && !data.value?.orders.length
  ? { text: "当前显示执行观察记录；成交与落库状态请核查确认和绑定事件。", tone: "warning" as const }
  : buildAdminOrderDiagnosisSummary(executionSteps.value, totalProfit.value, diagnosisContext.value));
const orchestrationStages = computed(() =>
  buildAdminOrderOrchestrationStages(executionSteps.value, totalProfit.value, diagnosisContext.value),
);
const orchestrationStartAt = computed(() => orchestrationStages.value[0]?.at || 0);

function fmtOrchestrationElapsed(at: number) {
  const ms = Math.max(0, Number(at) - orchestrationStartAt.value);
  if (ms < 1_000)
    return `+${Math.round(ms)}ms`;
  return `+${Number((ms / 1_000).toFixed(1))}s`;
}

const platformLabels = computed(() => {
  const labels = new Set<string>();
  for (const o of sortedOrders.value) {
    if (o.provider)
      labels.add(o.provider);
  }
  return [...labels].join(" · ");
});

const logStats = computed(() => ({
  total: data.value?.logStats?.total ?? (frontendLogFilter.value.related.length + filteredLogs.value.length),
  related: frontendLogFilter.value.related.length,
  unrelated: filteredLogs.value.length,
  truncated: data.value?.logStats?.truncated ?? false,
  limit: data.value?.logStats?.limit ?? 0,
}));

function logDetailParts(log: AdminOrderLogEntry) {
  const parts: string[] = [];
  if (log.accountLabel)
    parts.push(log.accountLabel);
  if (log.match)
    parts.push(log.match);
  if (log.bet)
    parts.push(log.bet);
  const odds = fmtMaybeNumber(log.requestOdds ?? log.odds);
  const amount = fmtMaybeNumber(log.requestAmount ?? log.betMoney);
  if (log.target || odds || amount) {
    parts.push(
      [
        log.target || "",
        odds ? `@${odds}` : "",
        amount ? `¥${amount}` : "",
      ].filter(Boolean).join(" "),
    );
  }
  if (log.matchedOrderId && !log.orderId)
    parts.push(`关联订单 #${log.matchedOrderId}`);
  if (log.relationReason)
    parts.push(`依据：${log.relationReason}`);
  return parts.filter(Boolean);
}

function attemptDividerLabel(prev: AdminOrderLogAttempt, next: AdminOrderLogAttempt) {
  if (prev.order?.status?.toLowerCase() === "reject")
    return "拒单后重下";
  if (!prev.order && next.order)
    return "再次下单";
  return "再次下单";
}

function legOrderAttempts(leg: AdminOrderLogLegSection) {
  return leg.attempts.filter(a => a.order);
}

function legProfit(leg: AdminOrderLogLegSection) {
  let sum = 0;
  for (const a of leg.attempts) {
    const o = a.order;
    if (!o)
      continue;
    sum += adminOrderMoneyCny({
      provider: o.provider,
      money: o.money,
      pfSide: o.pfSide,
      pmSide: o.pmSide,
    });
  }
  return sum;
}

const hasOverviewOrders = computed(() => sortedOrders.value.length > 0);

const executionLookup = ref<{ userId: string; linkId?: number; executionId?: string; attemptId?: string } | null>(null);

async function openExecution(input: NonNullable<typeof executionLookup.value>) {
  executionLookup.value = { ...input };
  lookupRows.value = [];
  expanded.value = false;
  await loadDiagnosis();
}

async function open(rows: AdminOrderRow[]) {
  if (!rows.length)
    return;
  executionLookup.value = null;
  lookupRows.value = [...rows];
  expanded.value = false;
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
    const payload = await getAdminOrderLogs(executionLookup.value || {
      userId: head.userId,
      linkId: head.linkId || undefined,
      orderId: !head.linkId ? head.orderId : undefined,
      domain: head.domain,
      sport: head.sport,
      venue: head.provider,
      paddingMs: expanded.value ? 1_800_000 : undefined,
      logLimit: expanded.value ? 5000 : undefined,
    });
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
  expanded.value = true;
  await loadDiagnosis();
}

async function copyReport() {
  if (!data.value)
    return;
  // [changmen 扩展] 仅复制摘要及核查提示，不导出账号凭证和接口原始请求。
  const report = [
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
                  日志窗口 {{ fmtTime(data.logWindow.fromMs) }} — {{ fmtTime(data.logWindow.toMs) }}
                </div>
              </div>

              <div class="admin-order-log-overview__stats">
                <div class="admin-order-log-stat">
                  <span class="admin-order-log-stat__label">平台</span>
                  <span class="admin-order-log-stat__value">{{ platformLabels || "—" }}</span>
                </div>
                <div class="admin-order-log-stat">
                  <span class="admin-order-log-stat__label">订单</span>
                  <span class="admin-order-log-stat__value">{{ executionLookup?.executionId || executionLookup?.attemptId ? "本次未查询" : `${sortedOrders.length} 笔` }}</span>
                </div>
                <div class="admin-order-log-stat">
                  <span class="admin-order-log-stat__label">日志</span>
                  <span class="admin-order-log-stat__value">
                    {{ logStats.related }} / {{ logStats.total }} 条相关
                  </span>
                </div>
                <div
                  class="admin-order-log-stat"
                  :class="{ 'admin-order-log-stat--warn': evidenceIssues.length > 0 }"
                >
                  <span class="admin-order-log-stat__label">诊断质量</span>
                  <span class="admin-order-log-stat__value">
                    <template v-if="logStats.truncated">
                      日志已截断 {{ logStats.limit }} 条
                    </template>
                    <template v-else-if="evidenceIssues.length">
                      证据不完整
                    </template>
                    <template v-else>
                      执行证据覆盖完整
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

              <el-alert v-if="evidenceIssues.length" type="warning" :closable="false" :title="evidenceIssues.join('；')" />
              <p class="admin-order-log-overview__window">
                建议核查：{{ suggestedCheck }}
              </p>
              <p class="admin-order-log-overview__window">
                明确 Link／订单 ID 的日志跨时间窗检索；时间窗用于旧日志关联。流程和金额公式包含推断，须结合技术明细核对。
              </p>

              <section
                v-if="executionSteps.length"
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

              <div v-if="legColumns.length" class="admin-order-log-overview__orders">
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
              <p v-else-if="!hasOverviewOrders" class="admin-order-log-overview__empty">
                该 Link 无落库订单
              </p>
            </section>

            <details v-if="data.observation" class="admin-order-log-technical" open>
              <summary class="admin-order-log-technical__summary">
                执行记录（与实时进度同源） · {{ data.observation.events.length }} 条事件
              </summary>
              <p>事件来自客户端上报，尚未独立核验场馆；此结果仅供核查，不参与下注或补单。</p>
              <el-alert v-for="issue in data.observation.issues" :key="issue" :title="issue" type="warning" :closable="false" />
              <section v-for="attempt in data.observation.attempts" :key="attempt.attemptId">
                <p>尝试 {{ attempt.attemptId }}</p>
                <el-alert v-for="finding in attempt.findings" :key="finding" :title="finding" type="warning" :closable="false" />
              </section>
              <section v-for="queue in data.observation.queues" :key="queue.queueId">
                <p>队列 {{ queue.queueId }}</p>
                <el-alert v-for="finding in queue.findings" :key="finding" :title="finding" type="warning" :closable="false" />
              </section>
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
        扩大旧日志窗口至前后30分钟
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
