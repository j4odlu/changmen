<script setup lang="ts">
import type { ActiveBetLeg, ActiveBetRun } from "@/types/activeBetRun";
import { storeToRefs } from "pinia";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import OrderExecutionTimeline from "@/components/order/OrderExecutionTimeline.vue";
import PlatformIcon from "@/components/platform/PlatformIcon.vue";
import { activeBetLegRole, activeBetRunMode, activeBetRunModeLabel, observationLegGroups, observationLegSummary, progressEvidenceWarnings, progressOrchestrationLabel } from "@/shared/activeBetRunPresentation";
import { formatActiveBetLinkLabel } from "@/shared/linkDisplay";
import {
  ACTIVE_BET_RUN_QUEUE_CAP,
  ACTIVE_BET_TERMINAL_LINGER_MS,
  useActiveBetRunStore,
} from "@/stores/activeBetRunStore";
import { useLoseOrderStore } from "@/stores/loseOrderStore";
import { useOrderObservationStore } from "@/stores/orderObservationStore";
import { useUserStore } from "@/stores/userStore";
import "@/styles/active-bet-run.css";

const PANEL_POS_KEY = "changmen:active-bet-run:pos:v4";
const PANEL_COLLAPSED_KEY = "changmen:active-bet-run:collapsed";
const PANEL_SIZE_KEY = "changmen:active-bet-run:size:v1";
/** [changmen 扩展] 双腿摘要与时间线共用可滚动舞台。 */
const PANEL_W = 500;
const PANEL_H = 560;
const PANEL_MIN_W = 360;
const PANEL_MIN_H = 260;

const activeStore = useActiveBetRunStore();
const loseStore = useLoseOrderStore();
const userStore = useUserStore();
const observationStore = useOrderObservationStore();
const { visibleRuns } = storeToRefs(activeStore);

const now = ref(Date.now());
const panelEl = ref<HTMLElement | null>(null);
const collapsed = ref(false);
const offset = ref<{ left: number; top: number } | null>(null);
const panelSize = ref({ width: PANEL_W, height: PANEL_H });
const dragging = ref(false);
const resizing = ref(false);
/** 当前展示的套利单下标（visibleRuns：0=最新） */
const activeIndex = ref(0);

const expandedTimeline = ref(false);
const copyLabel = ref("复制 Link");
let copyTimer: ReturnType<typeof setTimeout> | undefined;
let tickTimer: ReturnType<typeof setInterval> | undefined;
let dragCleanup: (() => void) | undefined;
let resizeCleanup: (() => void) | undefined;

const runCount = computed(() => visibleRuns.value.length);
const activeRun = computed(() => visibleRuns.value[activeIndex.value] ?? null);
const runFacts = computed(() => userStore.isLoggedIn
  ? observationStore.forLink(String(userStore.userId || ""), activeRun.value?.linkId)
  : []);
const factGroups = computed(() => observationLegGroups(runFacts.value, activeRun.value?.legs || []));
function legFacts(leg: ActiveBetLeg) { return factGroups.value.groups.get(leg.side) || []; }
const legSummaries = computed(() => new Map((activeRun.value?.legs || []).map(leg => [leg.side, observationLegSummary(legFacts(leg), leg.status, leg.precheckOnly)])));
function legSummary(leg: ActiveBetLeg) { return legSummaries.value.get(leg.side)!; }
function legProvider(leg: ActiveBetLeg) { return legSummary(leg).provider || leg.platform; }
const unassignedFacts = computed(() => factGroups.value.unassigned);
const hasMoreTimeline = computed(() => unassignedFacts.value.length > 6
  || (activeRun.value?.legs || []).some(leg => legFacts(leg).length > 6));
const evidenceWarnings = computed(() => progressEvidenceWarnings(runFacts.value));
function latestLegAction(leg: ActiveBetLeg) { return progressOrchestrationLabel(leg, legFacts(leg), leg.events.at(-1)?.detail || leg.detail || "等待执行"); }
function legPlacementLabel(leg: ActiveBetLeg) { return progressOrchestrationLabel(leg, legFacts(leg), activeStore.legPlacementLabel(leg, activeRun.value ?? undefined)); }
const executionId = computed(() => [...runFacts.value].reverse().find(event => event.executionId)?.executionId);
const elapsedLabel = computed(() => `${Math.max(0, Math.floor(((activeRun.value?.terminalAt || now.value) - (activeRun.value?.startedAt || now.value)) / 1000))}s`);
const localHistoryTruncated = computed(() => userStore.isLoggedIn && observationStore.truncatedOwners.includes(String(userStore.userId || "")));
const canPrev = computed(() => activeIndex.value < runCount.value - 1);
const canNext = computed(() => activeIndex.value > 0);
const pageLabel = computed(() => {
  if (!runCount.value)
    return `0/${ACTIVE_BET_RUN_QUEUE_CAP}`;
  return `${activeIndex.value + 1}/${runCount.value}`;
});

const panelStyle = computed(() => {
  const style: Record<string, string> = {
    position: "fixed",
    zIndex: "1200",
    boxSizing: "border-box",
  };
  if (!collapsed.value) {
    style.width = `${panelSize.value.width}px`;
    style.height = `${panelSize.value.height}px`;
  }
  else {
    style.width = "auto";
    style.minWidth = "200px";
    style.height = "auto";
  }
  if (offset.value) {
    style.left = `${offset.value.left}px`;
    style.top = `${offset.value.top}px`;
    style.right = "auto";
  }
  else {
    style.top = "72px";
    style.right = "16px";
    style.left = "auto";
  }
  return style;
});

onMounted(() => {
  if (userStore.config.makeUp)
    activeStore.bootstrapFromLoseOrders(loseStore.orders);
  tickTimer = setInterval(() => {
    now.value = Date.now();
  }, 1000);
  window.addEventListener("resize", normalizePanelGeometry);
  restorePanelPrefs();
  void nextTick(normalizePanelGeometry);
});

onUnmounted(() => {
  if (tickTimer)
    clearInterval(tickTimer);
  window.removeEventListener("resize", normalizePanelGeometry);
  dragCleanup?.();
  resizeCleanup?.();
  if (copyTimer)
    clearTimeout(copyTimer);
});

watch(
  visibleRuns,
  (runs, prev) => {
    const prevNewestId = prev?.[0]?.betId;
    const newestId = runs[0]?.betId;
    // 有新单进队：切到最新
    if (newestId != null && newestId !== prevNewestId)
      activeIndex.value = 0;
    else if (activeIndex.value >= runs.length)
      activeIndex.value = Math.max(0, runs.length - 1);
  },
  { deep: true },
);

watch(activeIndex, () => {
  expandedTimeline.value = false;
  copyLabel.value = "复制 Link";
});
watch(
  () => userStore.config.makeUp,
  (enabled) => {
    if (enabled)
      activeStore.bootstrapFromLoseOrders(loseStore.orders);
  },
);

function restorePanelPrefs() {
  try {
    collapsed.value = localStorage.getItem(PANEL_COLLAPSED_KEY) === "1";
    const raw = localStorage.getItem(PANEL_POS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { left?: unknown; top?: unknown };
      const left = Number(parsed.left);
      const top = Number(parsed.top);
      if (Number.isFinite(left) && Number.isFinite(top))
        offset.value = { left, top };
    }
    const sizeRaw = localStorage.getItem(PANEL_SIZE_KEY);
    if (sizeRaw) {
      const parsed = JSON.parse(sizeRaw) as { width?: unknown; height?: unknown };
      const width = Number(parsed.width);
      const height = Number(parsed.height);
      if (Number.isFinite(width) && Number.isFinite(height))
        panelSize.value = { width, height };
    }
  }
  catch {
    /* ignore */
  }
}

function persistCollapsed() {
  try {
    localStorage.setItem(PANEL_COLLAPSED_KEY, collapsed.value ? "1" : "0");
  }
  catch {
    /* ignore */
  }
}

function persistOffset() {
  if (!offset.value)
    return;
  try {
    localStorage.setItem(PANEL_POS_KEY, JSON.stringify(offset.value));
  }
  catch {
    /* ignore */
  }
}

function persistSize() {
  try {
    localStorage.setItem(PANEL_SIZE_KEY, JSON.stringify(panelSize.value));
  }
  catch {
    /* ignore */
  }
}

function toggleCollapsed() {
  collapsed.value = !collapsed.value;
  persistCollapsed();
  if (!collapsed.value)
    void nextTick(normalizePanelGeometry);
}

function showPrev() {
  if (!canPrev.value)
    return;
  activeIndex.value += 1;
}

function showNext() {
  if (!canNext.value)
    return;
  activeIndex.value -= 1;
}

function clampOffset(left: number, top: number): { left: number; top: number } {
  const el = panelEl.value;
  const w = el?.offsetWidth ?? PANEL_W;
  const h = el?.offsetHeight ?? 40;
  return {
    left: Math.min(Math.max(0, left), Math.max(0, window.innerWidth - w)),
    top: Math.min(Math.max(0, top), Math.max(0, window.innerHeight - h)),
  };
}

function clampPanelSize(width: number, height: number, maxWidth: number, maxHeight: number) {
  return {
    width: Math.min(Math.max(PANEL_MIN_W, width), Math.max(1, maxWidth)),
    height: Math.min(Math.max(PANEL_MIN_H, height), Math.max(1, maxHeight)),
  };
}

function normalizePanelGeometry() {
  if (collapsed.value) {
    if (offset.value)
      offset.value = clampOffset(offset.value.left, offset.value.top);
    return;
  }
  const rect = panelEl.value?.getBoundingClientRect();
  const left = Math.min(Math.max(0, offset.value?.left ?? rect?.left ?? 0), Math.max(0, window.innerWidth - PANEL_MIN_W));
  const top = Math.min(Math.max(0, offset.value?.top ?? rect?.top ?? 0), Math.max(0, window.innerHeight - PANEL_MIN_H));
  panelSize.value = clampPanelSize(
    panelSize.value.width,
    panelSize.value.height,
    window.innerWidth - left,
    window.innerHeight - top,
  );
  offset.value = {
    left: Math.min(Math.max(0, left), Math.max(0, window.innerWidth - panelSize.value.width)),
    top: Math.min(Math.max(0, top), Math.max(0, window.innerHeight - panelSize.value.height)),
  };
}

function onDragHandlePointerDown(ev: PointerEvent) {
  if (ev.button !== 0)
    return;
  if ((ev.target as HTMLElement | null)?.closest("button"))
    return;
  const el = panelEl.value;
  if (!el)
    return;

  ev.preventDefault();
  const rect = el.getBoundingClientRect();
  const originLeft = rect.left;
  const originTop = rect.top;
  const startX = ev.clientX;
  const startY = ev.clientY;
  offset.value = { left: originLeft, top: originTop };
  dragging.value = true;

  const onMove = (moveEv: PointerEvent) => {
    offset.value = clampOffset(
      originLeft + (moveEv.clientX - startX),
      originTop + (moveEv.clientY - startY),
    );
  };
  const onUp = () => {
    dragging.value = false;
    dragCleanup?.();
    dragCleanup = undefined;
    if (offset.value)
      offset.value = clampOffset(offset.value.left, offset.value.top);
    persistOffset();
  };

  dragCleanup?.();
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp, { once: true });
  window.addEventListener("pointercancel", onUp, { once: true });
  dragCleanup = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
  };
}

function onResizePointerDown(ev: PointerEvent) {
  if (ev.button !== 0 || collapsed.value)
    return;
  const el = panelEl.value;
  if (!el)
    return;

  ev.preventDefault();
  ev.stopPropagation();
  const rect = el.getBoundingClientRect();
  const originLeft = rect.left;
  const originTop = rect.top;
  const originWidth = rect.width;
  const originHeight = rect.height;
  const startX = ev.clientX;
  const startY = ev.clientY;
  offset.value = { left: originLeft, top: originTop };
  resizing.value = true;

  const onMove = (moveEv: PointerEvent) => {
    const nextSize = clampPanelSize(
      originWidth + (moveEv.clientX - startX),
      originHeight + (moveEv.clientY - startY),
      window.innerWidth - originLeft,
      window.innerHeight - originTop,
    );
    panelSize.value = nextSize;
    offset.value = { left: originLeft, top: originTop };
  };
  const onUp = () => {
    resizing.value = false;
    resizeCleanup?.();
    resizeCleanup = undefined;
    persistOffset();
    persistSize();
  };

  resizeCleanup?.();
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp, { once: true });
  window.addEventListener("pointercancel", onUp, { once: true });
  resizeCleanup = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
  };
}

function eventTime(at: number): string {
  return new Date(at).toLocaleTimeString("zh-CN", { hour12: false });
}
async function copyLink() {
  if (!activeRun.value?.linkId)
    return;
  try { await navigator.clipboard.writeText(String(activeRun.value.linkId)); copyLabel.value = "已复制"; }
  catch { copyLabel.value = "复制失败"; }
  if (copyTimer)
    clearTimeout(copyTimer);
  copyTimer = setTimeout(() => { copyLabel.value = "复制 Link"; }, 2000);
}
function shortOrderId(id: string | undefined): string {
  if (!id)
    return "尚未记录";
  return id.length > 20 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id;
}
function legTarget(target: string): string {
  return target === "Home" ? "主队" : target === "Away" ? "客队" : target;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function colToneClass(run: ActiveBetRun): string {
  const active = run.legs.filter(l => l.status !== "skipped" && !l.precheckOnly);
  const hasRejected = active.some(l => l.status === "rejected" || l.status === "failed");
  if (hasRejected)
    return "active-bet-run__col--danger";
  const allConfirmed = active.length > 0 && active.every(l => l.status === "confirmed");
  if (allConfirmed && (run.phase === "syncing" || run.phase === "settling"))
    return "active-bet-run__col--success";
  const hasPmPending = active.some(l => l.status === "pending_confirm");
  if (run.phase === "makeup" || hasPmPending)
    return "active-bet-run__col--makeup";
  if (run.phase === "placing" || run.phase === "settling" || run.phase === "checking")
    return "active-bet-run__col--pending";
  return "";
}

function phaseLabel(run: ActiveBetRun): string {
  if (run.terminalAt) {
    const left = Math.max(0, Math.ceil((run.terminalAt + ACTIVE_BET_TERMINAL_LINGER_MS - now.value) / 1000));
    return left > 0 ? `${run.overallLabel} · ${left}s 后收起` : run.overallLabel;
  }
  if (run.countdownUntil && (run.phase === "settling" || run.phase === "syncing")) {
    const left = Math.max(0, Math.ceil((run.countdownUntil - now.value) / 1000));
    if (left > 0) {
      if (run.phase === "syncing")
        return `同步倒计时 ${left}s`;
      return `等待确认 ${left}s`;
    }
  }
  return run.overallLabel;
}

function hasMakeupFlow(run: ActiveBetRun): boolean {
  return run.phase === "makeup" || run.legs.some(leg =>
    leg.status === "makeup" || leg.events?.some(event => event.stage === "补单"),
  );
}

function flowLabels(run: ActiveBetRun): string[] {
  if (activeBetRunMode(run) === "single9999" || activeBetRunMode(run) === "valueBet")
    return ["预检", "单腿下单", "确认", "结果"];
  return hasMakeupFlow(run)
    ? ["预检", "下单", "确认", "补单", "结果"]
    : ["预检", "下单", "确认", "结果"];
}

function currentFlowIndex(run: ActiveBetRun): number {
  const labels = flowLabels(run);
  if (run.terminalAt)
    return labels.length - 1;
  if (run.phase === "preparing" || run.phase === "checking")
    return 0;
  if (run.phase === "placing")
    return 1;
  if (run.phase === "settling")
    return 2;
  if (run.phase === "makeup")
    return labels.indexOf("补单");
  return Math.max(2, labels.length - 2);
}

function flowStepClass(run: ActiveBetRun, index: number): string {
  const current = currentFlowIndex(run);
  if (index < current)
    return "done";
  if (index > current)
    return "pending";
  if (run.terminalAt && run.legs.some(leg => leg.status === "failed" || leg.status === "rejected"))
    return "danger";
  return "current";
}

function nextAction(run: ActiveBetRun): string {
  const mode = activeBetRunMode(run);
  if (mode === "single9999") {
    if (run.terminalAt)
      return "本轮单边下单已结束；仅预检腿不计入成交结果。";
    if (run.phase === "preparing" || run.phase === "checking")
      return "校验下单腿及启用的 9999 预检腿；仅预检腿不会提交订单。";
    if (run.phase === "placing")
      return "正在向场馆提交下单腿；9999 侧不下单。";
    return "仅跟踪下单腿的确认结果；9999 侧不要求成交。";
  }
  if (mode === "valueBet") {
    if (run.terminalAt)
      return "本轮正EV 单腿下单已结束，请核查该腿执行结果。";
    if (run.phase === "preparing" || run.phase === "checking")
      return "正在校验正EV 下单腿的盘口和下注条件。";
    if (run.phase === "placing")
      return "正在向场馆提交正EV 下单腿。";
    return "正在跟踪正EV 下单腿的场馆确认结果。";
  }
  if (run.terminalAt)
    return "本轮编排已收尾；确认和补单结果仍需核查执行记录。";
  if (run.phase === "preparing" || run.phase === "checking")
    return mode === "arb" ? "正在校验两腿盘口；任一腿未通过都不会进入首轮下单。" : "正在校验盘口和下注条件。";
  if (run.phase === "placing")
    return mode === "arb" ? "双腿预检已通过，正在向场馆提交订单。" : "正在向场馆提交订单。";
  if (run.phase === "settling")
    return "接口受理不等于成交，正在等待场馆最终状态。";
  if (run.phase === "makeup")
    return "存在待处理腿，正在续查原单或按已成交敞口补单。";
  return "场馆处理已结束，正在同步订单结果。";
}

function legSideLabel(side: ActiveBetLeg["side"]): string {
  return side === "A" ? "A腿" : "B腿";
}

function orderLabel(run: ActiveBetRun, index: number): string {
  return formatActiveBetLinkLabel(run.linkId) ?? `订单 ${index + 1}`;
}
</script>

<template>
  <Teleport to="body">
    <aside ref="panelEl" class="active-bet-run" :class="{ 'active-bet-run--collapsed': collapsed, 'active-bet-run--dragging': dragging, 'active-bet-run--resizing': resizing }" :style="panelStyle" aria-label="实时下单进度">
      <header class="active-bet-run__chrome" title="按住拖动" @pointerdown="onDragHandlePointerDown">
        <div class="active-bet-run__heading">
          <span class="active-bet-run__live-dot" :class="{ 'is-active': !!activeRun && !activeRun.terminalAt }" />
          <strong>实时下单进度</strong>
          <span class="active-bet-run__count">{{ runCount }}</span>
        </div>
        <button type="button" class="active-bet-run__fold" :title="collapsed ? '展开' : '收起'" :aria-expanded="!collapsed" @click.stop="toggleCollapsed">
          {{ collapsed ? '展开' : '—' }}
        </button>
      </header>
      <template v-if="!collapsed">
        <nav class="active-bet-run__toolbar" aria-label="切换执行任务">
          <span>进行中 / 最近结束</span>
          <div class="active-bet-run__pagination">
            <button type="button" :disabled="!canPrev" aria-label="上一笔（更旧）" @click="showPrev">
              ‹
            </button>
            <span>{{ pageLabel }}</span>
            <button type="button" :disabled="!canNext" aria-label="下一笔（更新）" @click="showNext">
              ›
            </button>
            <button type="button" :disabled="activeIndex === 0" @click="activeIndex = 0">
              最新
            </button>
          </div>
        </nav>
        <div class="active-bet-run__body">
          <div v-if="!activeRun" class="active-bet-run__empty">
            <strong>暂无实时下单任务</strong>
            <span>开始执行后显示两腿进度、确认及补单记录</span>
          </div>
          <article v-else :key="activeRun.betId" class="active-bet-run__col" :class="colToneClass(activeRun)">
            <header class="active-bet-run__col-head">
              <div class="active-bet-run__order-heading">
                <strong :title="`完整 Link：${activeRun.linkId || '未记录'}`">{{ orderLabel(activeRun, activeIndex) }}</strong><button type="button" :disabled="!activeRun.linkId" title="复制完整 Link，用于后台执行诊断" @click="copyLink">
                  {{ copyLabel }}
                </button>
              </div>
              <span class="active-bet-run__phase">编排 · {{ phaseLabel(activeRun) }}</span>
            </header>
            <div class="active-bet-run__match">
              {{ stripHtml(activeRun.matchTitle) }}
            </div>
            <div class="active-bet-run__market">
              {{ stripHtml(activeRun.betName) }}
            </div>
            <div class="active-bet-run__mode" :data-mode="activeBetRunMode(activeRun)">
              下单模式 · <strong>{{ activeBetRunModeLabel(activeRun) }}</strong>
              <span v-if="activeBetRunMode(activeRun) === 'single9999'">只提交下单腿，9999 侧不下单</span>
            </div>
            <div class="active-bet-run__run-meta">
              <span>开始 {{ eventTime(activeRun.startedAt) }}</span><span>已用时 {{ elapsedLabel }}</span><span>更新 {{ eventTime(activeRun.updatedAt) }}</span>
            </div>
            <ol class="active-bet-run__flow" aria-label="编排流程">
              <li v-for="(label, index) in flowLabels(activeRun)" :key="label" class="active-bet-run__flow-step" :class="`active-bet-run__flow-step--${flowStepClass(activeRun, index)}`">
                <span class="active-bet-run__flow-dot" />{{ label }}
              </li>
            </ol>
            <p class="active-bet-run__next-action">
              编排提示 · {{ nextAction(activeRun) }}
            </p>
            <header class="active-bet-run__section-head">
              <strong>{{ activeBetRunMode(activeRun) === 'arb' ? '双腿实时进度' : activeBetRunMode(activeRun) === 'single9999' ? '单边下单 / 预检进度' : '执行实时进度' }}</strong>
              <button v-if="hasMoreTimeline" type="button" @click="expandedTimeline = !expandedTimeline">
                {{ expandedTimeline ? '每组最近 6 条' : '展开全部记录' }}
              </button>
            </header>
            <div class="active-bet-run__legs">
              <section v-for="leg in activeRun.legs" :key="leg.side" class="active-bet-run__leg" :data-tone="legSummary(leg).tone">
                <header class="active-bet-run__leg-meta">
                  <span class="active-bet-run__leg-side">{{ legSideLabel(leg.side) }}</span><PlatformIcon :platform="legProvider(leg)" /><strong>{{ legProvider(leg) === 'Polymarket' ? 'PM' : legProvider(leg) }}</strong><span>{{ legTarget(leg.target) }}</span>
                </header>
                <span class="active-bet-run__leg-role" :class="{ 'is-precheck': leg.precheckOnly }">{{ activeBetLegRole(leg) }}</span>
                <strong class="active-bet-run__leg-status" :data-tone="legSummary(leg).tone" :title="legSummary(leg).basis">{{ legSummary(leg).label }}</strong>
                <p class="active-bet-run__leg-action" :title="latestLegAction(leg)">
                  <span>编排 · {{ legPlacementLabel(leg) }}</span>
                  {{ latestLegAction(leg) }}
                </p>
                <div class="active-bet-run__leg-quote">
                  <span>赔率 @{{ legSummary(leg).odds ?? (legFacts(leg).length ? '—' : leg.odds ?? '—') }}</span>
                  <span>{{ legSummary(leg).amount ?? (!legFacts(leg).length && leg.betMoney != null ? `${leg.betMoney}（币种未记录）` : '金额未记录') }}</span>
                </div>
                <OrderExecutionTimeline
                  v-if="legFacts(leg).length" :key="`${activeRun.betId}-${leg.side}`"
                  :title="legTarget(leg.target)" subtitle="执行时间线"
                  :events="legFacts(leg)" :started-at="activeRun.startedAt" :expanded="expandedTimeline"
                />
                <ul v-else class="active-bet-run__fallback-feed">
                  <li v-for="(event, index) in leg.events.slice(-3)" :key="index">
                    <time>{{ eventTime(event.at) }}</time><span>{{ event.stage }}</span>
                    <p>编排记录 · {{ event.detail }}</p>
                  </li>
                  <li v-if="!leg.events.length">
                    尚无执行记录
                  </li>
                </ul>
                <details class="active-bet-run__leg-diagnostic">
                  <summary>诊断详情</summary>
                  <p class="active-bet-run__leg-basis">
                    {{ legSummary(leg).basis }}
                  </p>
                  <dl class="active-bet-run__leg-stats">
                    <dt>记录赔率</dt><dd>{{ legSummary(leg).odds ?? (legFacts(leg).length ? '—' : leg.odds ?? '—') }}</dd>
                    <dt>记录金额</dt><dd>{{ legSummary(leg).amount ?? (!legFacts(leg).length && leg.betMoney != null ? `${leg.betMoney}（币种未记录）` : '本次未记录') }}</dd>
                    <dt>订单</dt><dd :title="legSummary(leg).orderId">
                      {{ shortOrderId(legSummary(leg).orderId) }}
                    </dd>
                    <dt>落库回执</dt><dd>{{ legSummary(leg).bound ? '已记录保存成功' : '尚未记录成功' }}</dd>
                  </dl>
                </details>
                <footer class="active-bet-run__leg-footer">
                  <span>最近尝试</span><span v-if="legSummary(leg).accountId">账号 #{{ legSummary(leg).accountId }}</span><span v-if="legProvider(leg) !== leg.platform">首轮 {{ leg.platform }}</span><span v-if="legSummary(leg).retries">重试 {{ legSummary(leg).retries }} 次</span><span v-if="legSummary(leg).makeups">补单任务 {{ legSummary(leg).makeups }}</span>
                </footer>
              </section>
            </div>
            <p v-if="localHistoryTruncated" class="active-bet-run__notice">
              本地历史已裁剪，完整记录请结合后台诊断核查。
            </p>
            <p v-for="warning in evidenceWarnings" :key="warning" class="active-bet-run__notice">
              {{ warning }}
            </p>
            <details v-if="unassignedFacts.length" class="active-bet-run__orchestration">
              <summary>整单 / 归属待核查记录 · {{ unassignedFacts.length }} 条</summary>
              <OrderExecutionTimeline
                :key="`${activeRun.betId}-unassigned`"
                title="整单 / 归属待核查" subtitle="未分配到主客方向"
                :events="unassignedFacts" :started-at="activeRun.startedAt" :expanded="true"
              />
            </details>
            <details class="active-bet-run__orchestration">
              <summary>编排补充记录</summary>
              <ul>
                <li v-for="(event, index) in activeRun.events" :key="`run-${index}`">
                  <time>{{ eventTime(event.at) }}</time> {{ event.stage }} · {{ event.detail }}
                </li>
              </ul>
              <div v-for="leg in activeRun.legs" :key="leg.side">
                <strong>{{ legSideLabel(leg.side) }} · {{ legPlacementLabel(leg) }}</strong><ul>
                  <li v-for="(event, index) in leg.events" :key="index">
                    <time>{{ eventTime(event.at) }}</time> {{ event.stage }} · {{ event.detail }}
                  </li>
                </ul>
              </div>
            </details>
          </article>
        </div>
        <footer class="active-bet-run__footer" :title="executionId ? `执行编号：${executionId}` : '执行编号尚未记录'">
          <span>本地执行记录 · 后台同源</span><span title="后台展示已接收的记录，上传可能存在延迟">后台可能延迟</span>
        </footer>
        <button type="button" class="active-bet-run__resize-handle" title="拖动调整窗口大小" aria-label="调整实时下单进度框大小" @pointerdown="onResizePointerDown" />
      </template>
    </aside>
  </Teleport>
</template>
