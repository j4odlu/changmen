<script setup lang="ts">
import type { ActiveBetLeg, ActiveBetRun } from "@/types/activeBetRun";
import { storeToRefs } from "pinia";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import PlatformIcon from "@/components/platform/PlatformIcon.vue";
import { formatActiveBetLinkLabel } from "@/shared/linkDisplay";
import {
  ACTIVE_BET_RUN_QUEUE_CAP,
  ACTIVE_BET_TERMINAL_LINGER_MS,
  useActiveBetRunStore,
} from "@/stores/activeBetRunStore";
import { useLoseOrderStore } from "@/stores/loseOrderStore";
import { useUserStore } from "@/stores/userStore";
import "@/styles/active-bet-run.css";

const PANEL_POS_KEY = "changmen:active-bet-run:pos:v4";
const PANEL_COLLAPSED_KEY = "changmen:active-bet-run:collapsed";
const PANEL_SIZE_KEY = "changmen:active-bet-run:size:v1";
/** 默认宽度：与原先列表上方单笔栏一致（双腿并排共 460） */
const PANEL_W = 460;
const PANEL_H = 370;
const PANEL_MIN_W = 360;
const PANEL_MIN_H = 260;

const activeStore = useActiveBetRunStore();
const loseStore = useLoseOrderStore();
const userStore = useUserStore();
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

const legEventFeedEls = new Map<string, HTMLElement>();
let tickTimer: ReturnType<typeof setInterval> | undefined;
let dragCleanup: (() => void) | undefined;
let resizeCleanup: (() => void) | undefined;

const runCount = computed(() => visibleRuns.value.length);
const activeRun = computed(() => visibleRuns.value[activeIndex.value] ?? null);
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
  restorePanelPrefs();
  void nextTick(normalizePanelGeometry);
});

onUnmounted(() => {
  if (tickTimer)
    clearInterval(tickTimer);
  dragCleanup?.();
  resizeCleanup?.();
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
    void nextTick(scrollActiveLegFeedsToBottom);
  },
  { deep: true },
);

watch(activeIndex, () => {
  void nextTick(scrollActiveLegFeedsToBottom);
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
    width: Math.min(Math.max(PANEL_MIN_W, width), Math.max(PANEL_MIN_W, maxWidth)),
    height: Math.min(Math.max(PANEL_MIN_H, height), Math.max(PANEL_MIN_H, maxHeight)),
  };
}

function normalizePanelGeometry() {
  if (collapsed.value)
    return;
  const rect = panelEl.value?.getBoundingClientRect();
  const left = offset.value?.left ?? rect?.left ?? 0;
  const top = offset.value?.top ?? rect?.top ?? 0;
  panelSize.value = clampPanelSize(
    panelSize.value.width,
    panelSize.value.height,
    window.innerWidth - left,
    window.innerHeight - top,
  );
  if (offset.value) {
    offset.value = {
      left: Math.min(Math.max(0, left), Math.max(0, window.innerWidth - panelSize.value.width)),
      top: Math.min(Math.max(0, top), Math.max(0, window.innerHeight - panelSize.value.height)),
    };
  }
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
  const originRight = rect.right;
  const originWidth = rect.width;
  const originHeight = rect.height;
  const startX = ev.clientX;
  const startY = ev.clientY;
  offset.value = { left: originLeft, top: originTop };
  resizing.value = true;

  const onMove = (moveEv: PointerEvent) => {
    const nextSize = clampPanelSize(
      originWidth + (startX - moveEv.clientX),
      originHeight + (moveEv.clientY - startY),
      originRight,
      window.innerHeight - originTop,
    );
    panelSize.value = nextSize;
    offset.value = { left: originRight - nextSize.width, top: originTop };
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

function legEventKey(betId: number, side: ActiveBetLeg["side"]): string {
  return `${betId}:${side}`;
}

function setLegEventFeedEl(betId: number, side: ActiveBetLeg["side"], el: Element | null) {
  const key = legEventKey(betId, side);
  if (el)
    legEventFeedEls.set(key, el as HTMLElement);
  else
    legEventFeedEls.delete(key);
}

function scrollActiveLegFeedsToBottom() {
  const run = activeRun.value;
  if (!run)
    return;
  for (const leg of run.legs) {
    const el = legEventFeedEls.get(legEventKey(run.betId, leg.side));
    if (el)
      el.scrollTop = el.scrollHeight;
  }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function legClass(leg: ActiveBetLeg): string {
  return `active-bet-run__leg--${leg.status}`;
}

function colToneClass(run: ActiveBetRun): string {
  const active = run.legs.filter(l => l.status !== "skipped");
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
        return `双腿已成交 ${left}s`;
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
  if (run.terminalAt)
    return "本轮已经结束；完整原因和历史记录请在订单诊断中查看。";
  if (run.phase === "preparing" || run.phase === "checking")
    return "正在校验两腿盘口；任一腿未通过都不会进入首轮下单。";
  if (run.phase === "placing")
    return "双腿预检已通过，正在向场馆提交订单。";
  if (run.phase === "settling")
    return "接口受理不等于成交，正在等待场馆最终状态。";
  if (run.phase === "makeup")
    return "存在待处理腿，正在续查原单或按已成交敞口补单。";
  return "场馆处理已结束，正在同步订单结果。";
}

function formatLegMoney(betMoney?: number): string | undefined {
  if (betMoney == null || !Number.isFinite(betMoney) || betMoney <= 0)
    return undefined;
  return `¥${Math.round(betMoney)}`;
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
    <div
      ref="panelEl"
      class="active-bet-run"
      :class="{
        'active-bet-run--collapsed': collapsed,
        'active-bet-run--dragging': dragging,
        'active-bet-run--resizing': resizing,
      }"
      :style="panelStyle"
    >
      <div
        class="active-bet-run__chrome"
        title="按住拖动"
        @pointerdown="onDragHandlePointerDown"
      >
        <span class="active-bet-run__chrome-title">
          实时下单进度 ({{ pageLabel }})
        </span>
        <button
          type="button"
          class="active-bet-run__fold"
          :title="collapsed ? '展开' : '折叠'"
          :aria-expanded="!collapsed"
          @click.stop="toggleCollapsed"
        >
          {{ collapsed ? "展开" : "折叠" }}
        </button>
      </div>

      <div v-show="!collapsed" class="active-bet-run__body">
        <button
          type="button"
          class="active-bet-run__nav"
          :disabled="!canPrev"
          title="上一笔（更旧）"
          aria-label="上一笔"
          @click="showPrev"
        >
          ‹
        </button>

        <div class="active-bet-run__stage">
          <p v-if="!activeRun" class="active-bet-run__empty">
            暂无实时下单任务
          </p>
          <article
            v-else
            :key="activeRun.betId"
            class="active-bet-run__col"
            :class="colToneClass(activeRun)"
          >
            <header class="active-bet-run__col-head">
              <span class="active-bet-run__col-label">{{ orderLabel(activeRun, activeIndex) }}</span>
              <span class="active-bet-run__phase">{{ phaseLabel(activeRun) }}</span>
            </header>

            <div
              class="active-bet-run__meta-line"
              :title="stripHtml(activeRun.matchTitle)"
            >
              <span class="active-bet-run__match" v-html="activeRun.matchTitle" />
              <span class="active-bet-run__sep">·</span>
              <span
                class="active-bet-run__bet"
                :title="stripHtml(activeRun.betName)"
                v-html="activeRun.betName"
              />
            </div>

            <ol class="active-bet-run__flow" aria-label="下单流程">
              <li
                v-for="(label, index) in flowLabels(activeRun)"
                :key="label"
                class="active-bet-run__flow-step"
                :class="`active-bet-run__flow-step--${flowStepClass(activeRun, index)}`"
              >
                <span class="active-bet-run__flow-dot" />
                <span>{{ label }}</span>
              </li>
            </ol>

            <p class="active-bet-run__next-action">
              <span>当前判断</span>
              {{ nextAction(activeRun) }}
            </p>

            <div class="active-bet-run__legs">
              <div
                v-for="leg in activeRun.legs"
                :key="leg.side"
                class="active-bet-run__leg"
                :class="legClass(leg)"
                :title="leg.detail || undefined"
              >
                <div class="active-bet-run__leg-meta">
                  <span class="active-bet-run__leg-side">{{ legSideLabel(leg.side) }}</span>
                  <span class="active-bet-run__leg-platform" :title="leg.platform" :aria-label="leg.platform">
                    <PlatformIcon :platform="leg.platform" />
                  </span>
                  <span class="active-bet-run__leg-target">{{ leg.target }}</span>
                  <span v-if="leg.odds" class="active-bet-run__leg-odds">@{{ leg.odds }}</span>
                  <span v-if="formatLegMoney(leg.betMoney)" class="active-bet-run__leg-money">
                    {{ formatLegMoney(leg.betMoney) }}
                  </span>
                </div>
                <ul
                  v-if="leg.events?.length"
                  :ref="el => setLegEventFeedEl(activeRun.betId, leg.side, el as Element | null)"
                  class="active-bet-run__leg-events"
                >
                  <li
                    v-for="(ev, evIndex) in leg.events"
                    :key="`${activeRun.betId}-${leg.side}-${evIndex}`"
                    class="active-bet-run__leg-event"
                    :class="{ 'active-bet-run__leg-event--latest': evIndex === leg.events.length - 1 }"
                    :title="ev.detail"
                  >
                    <span
                      class="active-bet-run__leg-event-stage"
                      :data-layer="ev.stage"
                    >{{ ev.stage }}</span>
                    <span class="active-bet-run__leg-event-detail">{{ ev.detail }}</span>
                  </li>
                </ul>
              </div>
            </div>
          </article>
        </div>

        <button
          type="button"
          class="active-bet-run__nav"
          :disabled="!canNext"
          title="下一笔（更新）"
          aria-label="下一笔"
          @click="showNext"
        >
          ›
        </button>
      </div>

      <button
        v-show="!collapsed"
        type="button"
        class="active-bet-run__resize-handle"
        title="拖动调整宽度和高度"
        aria-label="调整实时下单进度框大小"
        @pointerdown="onResizePointerDown"
      />
    </div>
  </Teleport>
</template>
