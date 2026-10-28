<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import FloatingPanelLauncher from "@/components/FloatingPanelLauncher.vue";
import SignalList from "./SignalList.vue";
import { allSignals, clearAllSignals, signalFocusRequest, signalNow } from "./state";
import { useSignalMonitors } from "./useSignalMonitors";

const PANEL_POS_KEY = "changmen:pm-odds-drop:panel-pos:v1";
const PANEL_SIZE_KEY = "changmen:pm-odds-drop:panel-size:v1";
const PANEL_WIDTH = 540;
const PANEL_HEIGHT = 640;
const PANEL_MIN_WIDTH = 320;
const PANEL_MIN_HEIGHT = 260;
const { downSettings, upSettings, updateDownSettings, updateUpSettings } = useSignalMonitors();
const panelEl = ref<HTMLElement | null>(null);
const collapsed = ref(true);
const offset = ref<{ left: number; top: number } | null>(null);
const panelSize = ref({ width: PANEL_WIDTH, height: PANEL_HEIGHT });
const dragging = ref(false);
const resizing = ref(false);
const locateMessage = ref("");
const signalList = ref<InstanceType<typeof SignalList> | null>(null);
watch(signalFocusRequest, async (request) => {
  if (!request) return;
  collapsed.value = false;
  await nextTick();
  normalizePanelGeometry();
  await signalList.value?.reveal(request.id);
});
let dragCleanup: (() => void) | null = null;
let resizeCleanup: (() => void) | null = null;
let clockTimer: ReturnType<typeof setInterval> | null = null;
const monitorEnabled = computed({
  get: () => downSettings.value.enabled,
  set: value => updateDownSettings({ enabled: value }),
});
const upEnabled = computed({
  get: () => upSettings.value.enabled,
  set: value => updateUpSettings({ enabled: value }),
});
const active = computed(() => monitorEnabled.value || upEnabled.value);
const referenceLabel = computed(() => downSettings.value.referenceVenue === "Polymarket" ? "PM" : downSettings.value.referenceVenue);
const panelStyle = computed<Record<string, string>>(() => {
  const style: Record<string, string> = {
    width: collapsed.value ? "56px" : `${panelSize.value.width}px`,
    height: collapsed.value ? "56px" : `${panelSize.value.height}px`,
  };
  if (offset.value && !collapsed.value) {
    style.left = `${offset.value.left}px`;
    style.top = `${offset.value.top}px`;
  } else {
    style.right = "18px";
    style.bottom = "18px";
  }
  return style;
});
function clampOffset(left: number, top: number): { left: number; top: number } {
  const width = panelEl.value?.offsetWidth ?? PANEL_WIDTH;
  const height = panelEl.value?.offsetHeight ?? 44;
  return {
    left: Math.min(Math.max(0, left), Math.max(0, window.innerWidth - width)),
    top: Math.min(Math.max(0, top), Math.max(0, window.innerHeight - height)),
  };
}

function clampPanelSize(width: number, height: number, left: number, top: number) {
  return {
    width: Math.min(
      Math.max(PANEL_MIN_WIDTH, width),
      Math.max(1, window.innerWidth - left),
    ),
    height: Math.min(
      Math.max(PANEL_MIN_HEIGHT, height),
      Math.max(1, window.innerHeight - top),
    ),
  };
}

function normalizePanelGeometry() {
  if (collapsed.value) {
    return;
  }
  const rect = panelEl.value?.getBoundingClientRect();
  const left = Math.min(Math.max(0, offset.value?.left ?? rect?.left ?? 0), Math.max(0, window.innerWidth - PANEL_MIN_WIDTH));
  const top = Math.min(Math.max(0, offset.value?.top ?? rect?.top ?? 0), Math.max(0, window.innerHeight - PANEL_MIN_HEIGHT));
  panelSize.value = clampPanelSize(panelSize.value.width, panelSize.value.height, left, top);
  offset.value = {
    left: Math.min(Math.max(0, left), Math.max(0, window.innerWidth - panelSize.value.width)),
    top: Math.min(Math.max(0, top), Math.max(0, window.innerHeight - panelSize.value.height)),
  };
}

function restorePanelPrefs() {
  try {
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
      const size = JSON.parse(sizeRaw) as { width?: unknown; height?: unknown };
      const width = Number(size.width);
      const height = Number(size.height);
      if (Number.isFinite(width) && Number.isFinite(height))
        panelSize.value = { width, height };
    }
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

function persistPosition() {
  if (!offset.value)
    return;
  try {
    localStorage.setItem(PANEL_POS_KEY, JSON.stringify(offset.value));
  }
  catch {
    /* ignore */
  }
}

function toggleCollapsed() {
  collapsed.value = !collapsed.value;
  if (collapsed.value)
    return;
  void nextTick(() => {
    normalizePanelGeometry();
    persistPosition();
  });
}

function onDragPointerDown(event: PointerEvent) {
  if (event.button !== 0 || (event.target as HTMLElement | null)?.closest("button, input"))
    return;
  const panel = panelEl.value;
  if (!panel)
    return;
  event.preventDefault();
  const rect = panel.getBoundingClientRect();
  const startX = event.clientX;
  const startY = event.clientY;
  const originLeft = rect.left;
  const originTop = rect.top;
  offset.value = { left: originLeft, top: originTop };
  dragging.value = true;

  const onMove = (moveEvent: PointerEvent) => {
    offset.value = clampOffset(
      originLeft + moveEvent.clientX - startX,
      originTop + moveEvent.clientY - startY,
    );
  };
  const onUp = () => {
    dragging.value = false;
    dragCleanup?.();
    dragCleanup = null;
    persistPosition();
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

function onResizePointerDown(event: PointerEvent) {
  if (event.button !== 0 || collapsed.value)
    return;
  const panel = panelEl.value;
  if (!panel)
    return;
  event.preventDefault();
  event.stopPropagation();
  const rect = panel.getBoundingClientRect();
  const startX = event.clientX;
  const startY = event.clientY;
  const originWidth = rect.width;
  const originHeight = rect.height;
  offset.value = { left: rect.left, top: rect.top };
  resizing.value = true;

  const onMove = (moveEvent: PointerEvent) => {
    panelSize.value = clampPanelSize(
      originWidth + moveEvent.clientX - startX,
      originHeight + moveEvent.clientY - startY,
      rect.left,
      rect.top,
    );
  };
  const onUp = () => {
    resizing.value = false;
    resizeCleanup?.();
    resizeCleanup = null;
    persistPosition();
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

function locateSignalMatch(matchId: number) {
  locateMessage.value = "";
  const card = document.querySelector<HTMLElement>(`.match[data-match-id="${matchId}"]`);
  if (!card) {
    locateMessage.value = "该比赛当前被搜索或赛前筛选隐藏，请先调整筛选";
    return;
  }
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  card.animate([
    { boxShadow: "0 0 0 3px rgba(96, 165, 250, 0.95)" },
    { boxShadow: "0 0 0 3px rgba(96, 165, 250, 0)" },
  ], { duration: 1600, easing: "ease-out" });
}
onMounted(() => {
  window.addEventListener("resize", normalizePanelGeometry);
  restorePanelPrefs();
  signalNow.value = Date.now();
  clockTimer = setInterval(() => { signalNow.value = Date.now(); }, 1000);
  void nextTick(normalizePanelGeometry);
});
onUnmounted(() => {
  window.removeEventListener("resize", normalizePanelGeometry);
  dragCleanup?.();
  resizeCleanup?.();
  if (clockTimer) clearInterval(clockTimer);
});
</script>

<template>
  <aside ref="panelEl" class="pm-signals-panel" :class="{ 'is-collapsed': collapsed, 'is-dragging': dragging, 'is-resizing': resizing }" :style="panelStyle" aria-label="赔率异动信号中心">
    <FloatingPanelLauncher v-if="collapsed" label="赔率异动信号" caption="涨 / 跌" kind="odds-move" :count="allSignals.length" :active="active" @open="toggleCollapsed" />
    <header v-else class="pm-signals-panel__header" title="按住拖动" @pointerdown="onDragPointerDown">
      <div class="pm-signals-panel__heading"><span class="pm-signals-panel__live-dot" :class="{ 'is-active': active }" /><strong>赔率异动</strong><span class="pm-signals-panel__count">{{ allSignals.length }}</span></div>
      <button type="button" class="pm-signals-panel__icon-button" aria-label="收起赔率异动信号" :aria-expanded="true" @click.stop="toggleCollapsed">—</button>
    </header>
    <div v-show="!collapsed" class="pm-signals-panel__content">
      <nav class="pm-signals-panel__toolbar" aria-label="涨跌监测开关">
        <div class="pm-signals-panel__toolbar-actions">
          <button type="button" class="pm-signals-panel__monitor-button" :class="{ 'is-active': monitorEnabled }" :aria-pressed="monitorEnabled" @click="monitorEnabled = !monitorEnabled"><span class="pm-signals-panel__arrow" aria-hidden="true">↓</span> 降赔 {{ monitorEnabled ? '开' : '关' }}</button>
          <button type="button" class="pm-signals-panel__monitor-button" :class="{ 'is-active': upEnabled }" :aria-pressed="upEnabled" @click="upEnabled = !upEnabled"><span class="pm-signals-panel__arrow" aria-hidden="true">↑</span> 涨赔 {{ upEnabled ? '开' : '关' }}</button>
        </div>
        <button type="button" :disabled="!allSignals.length" @click="clearAllSignals">清空记录</button>
      </nav>
      <details class="pm-signals-panel__config">
        <summary>监测参数 <span>↓ {{ referenceLabel }} ≥ {{ downSettings.thresholdPct }}% · ↑ PM ≥ {{ upSettings.minRisePct }}%</span></summary>
        <p>↓ {{ referenceLabel }} 降幅 ≥ {{ downSettings.thresholdPct }}% · 窗口 {{ downSettings.windowMs / 1000 }}秒 · 冷却 {{ downSettings.cooldownMs / 1000 }}秒 · 赔率 {{ downSettings.minReferenceOdds }}—{{ downSettings.maxReferenceOdds }}</p>
        <p>↑ PM 涨幅 ≥ {{ upSettings.minRisePct }}% · 窗口 {{ upSettings.windowMs / 1000 }}秒 · 冷却 {{ upSettings.cooldownMs / 1000 }}秒 · 理论套利空间 ≥ {{ upSettings.minArbPct }}%</p>
        <p>完整参数及角标显示在「用户中心 → 界面 → 赔率异动」设置。快捷开关立即生效，点击该页「保存」后下次登录继续使用。</p>
      </details>
      <div class="pm-signals-panel__body">
        <div v-if="locateMessage" class="pm-signals-panel__notice" role="status">{{ locateMessage }}</div>
        <p v-if="!active" class="pm-signals-panel__paused">监测已关闭，开启上方涨赔或降赔开关开始监听。</p>
        <SignalList ref="signalList" :signals="allSignals" :now="signalNow" @locate="locateSignalMatch" />
      </div>
      <footer class="pm-signals-panel__footer"><span>历史快照 · 展开卡片查看报价详情</span><span class="pm-signals-panel__observe-only">仅观察 · 不自动下注</span></footer>
      <button type="button" class="pm-signals-panel__resize-handle" aria-label="调整赔率异动信号框大小" @pointerdown="onResizePointerDown" />
    </div>
  </aside>
</template>
<style scoped>
/* [changmen 扩展] 与实时下单进度统一窗口、工具栏和卡片层级。 */
.pm-signals-panel {
  position: fixed;
  z-index: 1250;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--el-text-color-primary, #e7edf7);
  font: 12px/1.5 system-ui, sans-serif;
  box-sizing: border-box;
  background: var(--el-bg-color, #141b29);
  border: 1px solid rgba(91, 112, 145, 0.65);
  border-radius: 10px;
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.38);
  backdrop-filter: blur(10px);
}

.pm-signals-panel.is-dragging,
.pm-signals-panel.is-resizing {
  user-select: none;
}

.pm-signals-panel.is-dragging {
  cursor: grabbing;
}

.pm-signals-panel__content { display: contents; }
/* [changmen 扩展] 收起时仅保留圆形入口及状态角标。 */
.pm-signals-panel.is-collapsed {
  overflow: visible;
  background: transparent;
  border: 0;
  border-radius: 50%;
  box-shadow: none;
  backdrop-filter: none;
}

.pm-signals-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 42px;
  padding: 0 10px 0 12px;
  flex: none;
  background: linear-gradient(90deg, rgba(21, 128, 61, 0.98), rgba(22, 101, 52, 0.98));
  border-bottom: 1px solid rgba(91, 112, 145, 0.35);
  cursor: grab;
  touch-action: none;
}

.is-collapsed .pm-signals-panel__header {
  border-bottom: 0;
}

.pm-signals-panel__heading,
.pm-signals-panel__toolbar,
.pm-signals-panel__toolbar-actions,
.pm-signals-panel__settings {
  display: flex;
  align-items: center;
}

.pm-signals-panel__heading {
  gap: 8px;
  font-size: 13px;
  white-space: nowrap;
}

.pm-signals-panel__live-dot {
  width: 8px;
  height: 8px;
  background: #64748b;
  border-radius: 50%;
}

.pm-signals-panel__live-dot.is-active {
  background: #34d399;
  box-shadow: 0 0 0 3px rgba(52, 211, 153, 0.14);
}

.pm-signals-panel__count {
  min-width: 20px;
  padding: 1px 6px;
  color: #c6d2e3;
  text-align: center;
  background: #2b384d;
  border-radius: 10px;
  font-size: 11px;
  box-sizing: border-box;
}

.pm-signals-panel__toolbar {
  justify-content: space-between;
  gap: 8px;
  padding: 7px 12px;
  flex: none;
  color: var(--el-text-color-secondary, #a8b2bf);
  background: var(--el-fill-color-light, #172235);
  border-bottom: 1px solid rgba(91, 112, 145, 0.15);
  font-size: 11px;
}

.pm-signals-panel__toolbar-actions {
  gap: 4px;
}

.pm-signals-panel button {
  color: var(--el-text-color-regular, #cbd5e1);
  font: inherit;
  background: transparent;
  border: 0;
  border-radius: 5px;
  cursor: pointer;
}

.pm-signals-panel button:disabled {
  color: var(--el-text-color-placeholder, #4f6078);
  cursor: default;
}

.pm-signals-panel button:focus-visible {
  outline: 2px solid #60a5fa;
  outline-offset: -2px;
}

.pm-signals-panel__toolbar-actions button {
  padding: 3px 6px;
}

.pm-signals-panel__icon-button {
  min-width: 28px;
  padding: 5px;
}

.pm-signals-panel__monitor-button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  color: var(--el-text-color-secondary, #94a3b8) !important;
  font-size: 11px !important;
  border: 1px solid rgba(100, 116, 139, 0.45) !important;
  border-radius: 4px;
}
.pm-signals-panel__arrow { font-size: 20px; font-weight: 900; line-height: 1; }

.pm-signals-panel__monitor-button.is-active {
  color: var(--el-color-success, #67c23a) !important;
  border-color: rgba(52, 211, 153, 0.45) !important;
}

.pm-signals-panel button:hover:not(:disabled) {
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 5px;
}

.pm-signals-panel__settings {
  flex: none;
  flex-wrap: wrap;
  gap: 8px 12px;
  padding: 7px 12px;
  font-size: 11px;
  color: #9fb0c7;
  background: rgba(10, 15, 24, 0.55);
}

.pm-signals-panel__settings--range {
  padding-top: 0;
  border-bottom: 1px solid rgba(91, 112, 145, 0.15);
}

.pm-signals-panel__settings--range input[type="number"] {
  width: 58px;
}

.pm-signals-panel__settings--range small {
  margin-left: auto;
  color: #65768e;
}

.pm-signals-panel__settings label {
  display: flex;
  gap: 5px;
  align-items: center;
}

.pm-signals-panel__settings input,
.pm-signals-panel__settings select {
  width: 48px;
  padding: 3px 4px;
  color: var(--el-text-color-primary, #e7edf7);
  text-align: right;
  background: #172235;
  border: 1px solid #394b66;
  border-radius: 4px;
  outline: none;
  font: inherit;
}

.pm-signals-panel__settings select {
  width: 54px;
  text-align: left;
}

.pm-signals-panel__settings input:focus,
.pm-signals-panel__settings select:focus {
  border-color: #60a5fa;
}

.pm-signals-panel__settings em {
  font-style: normal;
}

.pm-signals-panel__observe-only {
  color: #fbbf24;
}

.pm-signals-panel__body {
  flex: 1;
  min-height: 0;
  padding: 10px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: #394b66 transparent;
}

.pm-signals-panel__empty {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: center;
  justify-content: center;
  min-height: 160px;
  padding: 0 10px;
  text-align: center;
  color: #71829a;
  font-size: 12px;
}

.pm-signals-panel__notice {
  margin-bottom: 8px;
  padding: 6px 8px;
  color: #fbbf24;
  font-size: 11px;
  background: rgba(251, 191, 36, 0.08);
  border: 1px solid rgba(251, 191, 36, 0.2);
  border-radius: 5px;
}

.pm-signals-panel__empty strong {
  color: #c6d2e3;
  font-size: 13px;
}

.pm-signals-panel__footer {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  flex: none;
  gap: 4px 8px;
  padding: 7px 20px 7px 12px;
  color: var(--el-text-color-secondary, #a8b2bf);
  font-size: 10px;
  background: var(--el-fill-color-light, #172235);
  border-top: 1px solid rgba(91, 112, 145, 0.2);
}

.pm-signals-panel__resize-handle {
  position: absolute;
  right: 1px;
  bottom: 1px;
  width: 18px;
  height: 18px;
  cursor: nwse-resize !important;
  touch-action: none;
}

.pm-signals-panel__resize-handle::after {
  position: absolute;
  right: 4px;
  bottom: 4px;
  width: 8px;
  height: 8px;
  content: "";
  border-right: 2px solid #71829a;
  border-bottom: 2px solid #71829a;
}
.pm-signals-panel__header, .pm-signals-panel__header button { color: #e7edf7; }
.pm-signals-panel__config { flex: none; border-bottom: 1px solid #5b70914d; font-size: 11px; }
.pm-signals-panel__config > summary { padding: 7px 12px; cursor: pointer; }
.pm-signals-panel__config > summary > span { margin-left: 8px; color: var(--el-text-color-secondary, #a8b2bf); }
.pm-signals-panel__config > p { margin: 0; padding: 8px 12px; color: var(--el-text-color-secondary, #a8b2bf); }
.pm-signals-panel__paused { padding: 7px; border: 1px solid #5b70914d; border-radius: 5px; color: var(--el-text-color-secondary, #a8b2bf); }
</style>
