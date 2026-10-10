<script setup lang="ts">
import type { BrowserPmOddsDropSignal, OddsDropReferenceVenue } from "./runtime";
import type { PmOddsDropVenueQuote } from "./venueSnapshot";
import { storeToRefs } from "pinia";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useMatchStore } from "@/stores/matchStore";
import {
  clearPmOddsDropSignals,
  pmOddsDropSettings,
  pmOddsDropSignals,
  startPmOddsDropSignalMonitor,
  updatePmOddsDropSettings,
} from "./runtime";
import {
  readReferenceVenueQuotes,
  resolvePmOddsDropVenueSnapshot,
} from "./venueSnapshot";

const PANEL_POS_KEY = "changmen:pm-odds-drop:panel-pos:v1";
const PANEL_COLLAPSED_KEY = "changmen:pm-odds-drop:panel-collapsed:v1";
const PANEL_SIZE_KEY = "changmen:pm-odds-drop:panel-size:v1";
const PANEL_WIDTH = 500;
const PANEL_HEIGHT = 560;
const PANEL_MIN_WIDTH = 360;
const PANEL_MIN_HEIGHT = 260;

const matchStore = useMatchStore();
const { matchs } = storeToRefs(matchStore);
const panelEl = ref<HTMLElement | null>(null);
const collapsed = ref(false);
const offset = ref<{ left: number; top: number } | null>(null);
const panelSize = ref({ width: PANEL_WIDTH, height: PANEL_HEIGHT });
const dragging = ref(false);
const resizing = ref(false);
const now = ref(Date.now());
const locateMessage = ref("");

let stopMonitor: (() => void) | null = null;
let dragCleanup: (() => void) | null = null;
let resizeCleanup: (() => void) | null = null;
let clockTimer: ReturnType<typeof setInterval> | null = null;

const thresholdPct = computed({
  get: () => pmOddsDropSettings.value.thresholdPct,
  set: value => updatePmOddsDropSettings({ thresholdPct: Number(value) }),
});

const monitorEnabled = computed({
  get: () => pmOddsDropSettings.value.enabled,
  set: value => updatePmOddsDropSettings({ enabled: Boolean(value) }),
});

const windowSeconds = computed({
  get: () => pmOddsDropSettings.value.windowMs / 1_000,
  set: value => updatePmOddsDropSettings({ windowMs: Number(value) * 1_000 }),
});

const referenceVenue = computed<OddsDropReferenceVenue>({
  get: () => pmOddsDropSettings.value.referenceVenue,
  set: value => updatePmOddsDropSettings({ referenceVenue: value }),
});

const minReferenceOdds = computed({
  get: () => pmOddsDropSettings.value.minReferenceOdds,
  set: value => updatePmOddsDropSettings({ minReferenceOdds: Number(value) }),
});

const maxReferenceOdds = computed({
  get: () => pmOddsDropSettings.value.maxReferenceOdds,
  set: value => updatePmOddsDropSettings({ maxReferenceOdds: Number(value) }),
});

const panelStyle = computed<Record<string, string>>(() => {
  const style: Record<string, string> = {
    width: `${panelSize.value.width}px`,
    height: collapsed.value ? "auto" : `${panelSize.value.height}px`,
  };
  if (offset.value) {
    style.left = `${offset.value.left}px`;
    style.top = `${offset.value.top}px`;
  }
  else {
    style.right = "18px";
    style.bottom = "18px";
  }
  return style;
});

type SignalDisplay = BrowserPmOddsDropSignal & {
  matchId: number | null;
  matchTitle: string;
  marketTitle: string;
  sideLabel: string;
  pm: PmOddsDropVenueQuote | null;
  ob: PmOddsDropVenueQuote | null;
  ray: PmOddsDropVenueQuote | null;
  pb: PmOddsDropVenueQuote | null;
};

const displayedSignals = computed<SignalDisplay[]>(() => {
  return pmOddsDropSignals.value.map((signal) => {
    const snapshot = signal.venueSnapshot ?? resolvePmOddsDropVenueSnapshot(
      matchs.value,
      signal,
      signal.referenceVenue,
      signal.selection,
    );
    if (snapshot) {
      return {
        ...signal,
        matchId: snapshot.matchId,
        matchTitle: snapshot.matchTitle,
        marketTitle: snapshot.marketTitle,
        sideLabel: snapshot.sideLabel,
        pm: snapshot.pm,
        ob: snapshot.ob,
        ray: snapshot.ray,
        pb: snapshot.pb,
      };
    }
    return {
      ...signal,
      matchId: null,
      matchTitle: `${venueLabel(signal.referenceVenue)} 未合场盘口`,
      marketTitle: signal.referenceVenue === "Polymarket"
        ? `Token ${shortAsset(signal.assetId)}`
        : "盘口已离开当前比赛列表",
      sideLabel: "待识别",
      pm: null,
      ob: null,
      ray: null,
      pb: null,
    };
  });
});

function shortAsset(assetId: string): string {
  if (assetId.length <= 14)
    return assetId;
  return `${assetId.slice(0, 6)}…${assetId.slice(-6)}`;
}

function venueLabel(venue: OddsDropReferenceVenue): string {
  return venue === "Polymarket" ? "PM" : venue;
}

function sourceLabel(signal: BrowserPmOddsDropSignal): string {
  if (signal.referenceVenue !== "Polymarket")
    return "浏览器只读";
  return signal.sourceMode === "official" ? "官方直连" : "VPS转发";
}

function startMonitor() {
  if (stopMonitor || !monitorEnabled.value)
    return;
  stopMonitor = startPmOddsDropSignalMonitor((signal, venue, selection) => (
    resolvePmOddsDropVenueSnapshot(matchs.value, signal, venue, selection)
  ), venue => readReferenceVenueQuotes(matchs.value, venue));
}

function stopMonitorNow() {
  stopMonitor?.();
  stopMonitor = null;
}

function toggleMonitor() {
  monitorEnabled.value = !monitorEnabled.value;
}

function formatOdds(odds: number | undefined): string {
  return odds && odds > 0 ? odds.toFixed(3) : "—";
}

function formatEv(quote: PmOddsDropVenueQuote | null): string {
  if (!quote || !Number.isFinite(quote.evPercent) || quote.evPercent === 0)
    return "EV —";
  const value = Math.round(quote.evPercent * 10) / 10;
  return `EV ${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function evClass(quote: PmOddsDropVenueQuote | null): string {
  if (!quote || quote.evPercent === 0)
    return "is-empty";
  return quote.evPercent > 0 ? "is-positive" : "is-negative";
}

function ageLabel(timestamp: number): string {
  const seconds = Math.max(0, Math.floor((now.value - timestamp) / 1_000));
  if (seconds < 60)
    return `${seconds}秒前`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60)
    return `${minutes}分钟前`;
  return new Date(timestamp).toLocaleTimeString("zh-CN", { hour12: false });
}

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
    if (offset.value)
      offset.value = clampOffset(offset.value.left, offset.value.top);
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
  try {
    localStorage.setItem(PANEL_COLLAPSED_KEY, collapsed.value ? "1" : "0");
  }
  catch {
    /* ignore */
  }
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

function locateSignalMatch(signal: SignalDisplay) {
  locateMessage.value = "";
  if (signal.matchId == null) {
    locateMessage.value = `该${venueLabel(signal.referenceVenue)}盘口尚未匹配到比赛`;
    return;
  }
  const card = document.querySelector<HTMLElement>(`.match[data-match-id="${signal.matchId}"]`);
  if (!card) {
    locateMessage.value = "该比赛当前被搜索或赛前筛选隐藏，请先调整筛选";
    return;
  }
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  card.animate(
    [
      { boxShadow: "0 0 0 3px rgba(96, 165, 250, 0.95)" },
      { boxShadow: "0 0 0 3px rgba(96, 165, 250, 0)" },
    ],
    { duration: 1_600, easing: "ease-out" },
  );
}

onMounted(() => {
  window.addEventListener("resize", normalizePanelGeometry);
  restorePanelPrefs();
  startMonitor();
  clockTimer = setInterval(() => {
    now.value = Date.now();
  }, 1_000);
  void nextTick(() => {
    normalizePanelGeometry();
  });
});

onUnmounted(() => {
  window.removeEventListener("resize", normalizePanelGeometry);
  stopMonitorNow();
  clearPmOddsDropSignals();
  dragCleanup?.();
  dragCleanup = null;
  resizeCleanup?.();
  resizeCleanup = null;
  if (clockTimer)
    clearInterval(clockTimer);
});

watch(monitorEnabled, (enabled) => {
  if (enabled)
    startMonitor();
  else
    stopMonitorNow();
});
</script>

<template>
  <aside
    ref="panelEl"
    class="pm-drop-panel"
    :class="{ 'is-collapsed': collapsed, 'is-dragging': dragging, 'is-resizing': resizing }"
    :style="panelStyle"
    aria-label="降赔率信号"
  >
    <header class="pm-drop-panel__header" title="按住拖动" @pointerdown="onDragPointerDown">
      <div class="pm-drop-panel__heading">
        <span class="pm-drop-panel__live-dot" :class="{ 'is-active': monitorEnabled }" />
        <strong>{{ venueLabel(referenceVenue) }} 降赔率信号</strong>
        <span class="pm-drop-panel__count">{{ pmOddsDropSignals.length }}</span>
      </div>
      <button
        type="button"
        class="pm-drop-panel__icon-button"
        :title="collapsed ? '展开' : '收起'"
        :aria-expanded="!collapsed"
        @click.stop="toggleCollapsed"
      >
        {{ collapsed ? "展开" : "—" }}
      </button>
    </header>

    <template v-if="!collapsed">
      <nav class="pm-drop-panel__toolbar" aria-label="降赔率监测操作">
        <span>{{ monitorEnabled ? '正在监听实时赔率' : '监测已关闭' }}</span>
        <div class="pm-drop-panel__toolbar-actions">
          <button
            type="button"
            class="pm-drop-panel__monitor-button"
            :class="{ 'is-active': monitorEnabled }"
            :aria-pressed="monitorEnabled"
            :title="monitorEnabled ? '关闭全部降赔监测' : '开启降赔监测'"
            @click="toggleMonitor"
          >
            {{ monitorEnabled ? "监测开" : "监测关" }}
          </button>
          <button type="button" :disabled="!pmOddsDropSignals.length" @click="clearPmOddsDropSignals">清空</button>
        </div>
      </nav>
      <div class="pm-drop-panel__settings">
        <label>
          <span>基准</span>
          <select v-model="referenceVenue" aria-label="降赔率信号基准场馆">
            <option value="Polymarket">PM</option>
            <option value="OB">OB</option>
            <option value="RAY">RAY</option>
            <option value="PB">PB</option>
          </select>
        </label>
        <label>
          <span>降幅</span>
          <input v-model.number="thresholdPct" type="number" min="0.1" max="90" step="0.5">
          <em>%</em>
        </label>
        <label>
          <span>窗口</span>
          <input v-model.number="windowSeconds" type="number" min="0.5" max="60" step="0.5">
          <em>秒</em>
        </label>
      </div>
      <div class="pm-drop-panel__settings pm-drop-panel__settings--range">
        <label title="只过滤开启后产生的新信号">
          <span>{{ venueLabel(referenceVenue) }}赔率范围</span>
          <input v-model.number="minReferenceOdds" type="number" min="1.01" max="1000" step="0.1" aria-label="基准场馆最低赔率">
          <em>—</em>
          <input v-model.number="maxReferenceOdds" type="number" min="1.01" max="1000" step="0.1" aria-label="基准场馆最高赔率">
        </label>
        <small>仅显示范围内的新信号</small>
      </div>

      <div class="pm-drop-panel__body">
        <div v-if="locateMessage" class="pm-drop-panel__notice">
          {{ locateMessage }}
        </div>
        <div v-if="!monitorEnabled" class="pm-drop-panel__empty">
          <strong>降赔率监测已关闭</strong>
          <span>点击“监测关”开启，开启前不会扫描任何场馆</span>
        </div>
        <div v-else-if="!displayedSignals.length" class="pm-drop-panel__empty">
          <strong>正在监听{{ venueLabel(referenceVenue) }}实时赔率</strong>
          <span>{{ windowSeconds }}秒内下降 {{ thresholdPct }}% 时显示，不会自动下注</span>
        </div>

        <article
          v-for="signal in displayedSignals"
          :key="signal.id"
          class="pm-drop-signal"
          :class="{ 'is-locatable': signal.matchId != null }"
          :title="signal.matchId != null ? '双击定位到比赛' : `该${venueLabel(signal.referenceVenue)}盘口尚未匹配到比赛`"
          @dblclick="locateSignalMatch(signal)"
        >
          <div class="pm-drop-signal__topline">
            <strong>{{ venueLabel(signal.referenceVenue) }} · {{ signal.sideLabel }}</strong>
            <span class="pm-drop-signal__drop">↓ {{ signal.dropPct.toFixed(2) }}%</span>
          </div>
          <div class="pm-drop-signal__match" :title="signal.matchTitle">
            <strong>{{ signal.matchTitle }}</strong>
          </div>
          <div class="pm-drop-signal__market">
            {{ signal.marketTitle }}
          </div>
          <div class="pm-drop-signal__prices">
            <strong>{{ venueLabel(signal.referenceVenue) }}</strong>
            <span>{{ signal.beforeOdds.toFixed(3) }}</span>
            <b>→</b>
            <span class="is-current">{{ signal.currentOdds.toFixed(3) }}</span>
            <small v-if="signal.referenceVenue === 'Polymarket'">PM ask {{ signal.beforeBestAsk.toFixed(3) }} → {{ signal.currentBestAsk.toFixed(3) }}</small>
          </div>
          <div class="pm-drop-signal__ev-grid" aria-label="PM、OB、RAY和PB赔率EV对比">
            <span class="is-header">场馆</span>
            <span class="is-header">触发时赔率</span>
            <span class="is-header">对{{ venueLabel(signal.referenceVenue) }} EV</span>
            <strong>PM</strong>
            <span>{{ formatOdds(signal.pm?.odds) }}</span>
            <span
              :class="signal.referenceVenue === 'Polymarket' ? 'is-benchmark' : evClass(signal.pm)"
            >{{ signal.referenceVenue === "Polymarket" ? "基准" : formatEv(signal.pm) }}</span>
            <strong>OB</strong>
            <span>{{ formatOdds(signal.ob?.odds) }}</span>
            <span
              :class="signal.referenceVenue === 'OB' ? 'is-benchmark' : evClass(signal.ob)"
            >{{ signal.referenceVenue === "OB" ? "基准" : formatEv(signal.ob) }}</span>
            <strong>RAY</strong>
            <span>{{ formatOdds(signal.ray?.odds) }}</span>
            <span
              :class="signal.referenceVenue === 'RAY' ? 'is-benchmark' : evClass(signal.ray)"
            >{{ signal.referenceVenue === "RAY" ? "基准" : formatEv(signal.ray) }}</span>
            <strong>PB</strong>
            <span>{{ formatOdds(signal.pb?.odds) }}</span>
            <span
              :class="signal.referenceVenue === 'PB' ? 'is-benchmark' : evClass(signal.pb)"
            >{{ signal.referenceVenue === "PB" ? "基准" : formatEv(signal.pb) }}</span>
          </div>
          <footer>
            <span>{{ sourceLabel(signal) }}</span>
            <span>{{ (signal.windowMs / 1_000).toFixed(2) }}秒</span>
            <time :datetime="new Date(signal.detectedAt).toISOString()">{{ ageLabel(signal.detectedAt) }}</time>
          </footer>
        </article>
      </div>
      <footer class="pm-drop-panel__footer">
        <span>{{ displayedSignals.length }} 条信号 · 双击卡片定位比赛</span>
        <span class="pm-drop-panel__observe-only">仅观察 · 不自动下注</span>
      </footer>
      <button
        type="button"
        class="pm-drop-panel__resize-handle"
        title="拖动调整窗口大小"
        aria-label="调整降赔率信号框大小"
        @pointerdown="onResizePointerDown"
      />
    </template>
  </aside>
</template>

<style scoped>
/* [changmen 扩展] 与实时下单进度统一窗口、工具栏和卡片层级。 */
.pm-drop-panel {
  position: fixed;
  z-index: 1250;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: #e7edf7;
  font: 12px/1.5 system-ui, sans-serif;
  box-sizing: border-box;
  background: rgba(14, 20, 31, 0.96);
  border: 1px solid rgba(91, 112, 145, 0.65);
  border-radius: 10px;
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.38);
  backdrop-filter: blur(10px);
}

.pm-drop-panel.is-dragging,
.pm-drop-panel.is-resizing {
  user-select: none;
}

.pm-drop-panel.is-dragging {
  cursor: grabbing;
}

.pm-drop-panel__header {
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

.is-collapsed .pm-drop-panel__header {
  border-bottom: 0;
}

.pm-drop-panel__heading,
.pm-drop-panel__toolbar,
.pm-drop-panel__toolbar-actions,
.pm-drop-panel__settings,
.pm-drop-signal__topline,
.pm-drop-signal__prices,
.pm-drop-signal footer {
  display: flex;
  align-items: center;
}

.pm-drop-panel__heading {
  gap: 8px;
  font-size: 13px;
  white-space: nowrap;
}

.pm-drop-panel__live-dot {
  width: 8px;
  height: 8px;
  background: #64748b;
  border-radius: 50%;
}

.pm-drop-panel__live-dot.is-active {
  background: #34d399;
  box-shadow: 0 0 0 3px rgba(52, 211, 153, 0.14);
}

.pm-drop-panel__count {
  min-width: 20px;
  padding: 1px 6px;
  color: #c6d2e3;
  text-align: center;
  background: #2b384d;
  border-radius: 10px;
  font-size: 11px;
  box-sizing: border-box;
}

.pm-drop-panel__toolbar {
  justify-content: space-between;
  gap: 8px;
  padding: 7px 12px;
  flex: none;
  color: #7f91aa;
  background: rgba(10, 15, 24, 0.55);
  border-bottom: 1px solid rgba(91, 112, 145, 0.15);
  font-size: 11px;
}

.pm-drop-panel__toolbar-actions {
  gap: 4px;
}

.pm-drop-panel button {
  color: #cbd5e1;
  font: inherit;
  background: transparent;
  border: 0;
  border-radius: 5px;
  cursor: pointer;
}

.pm-drop-panel button:disabled {
  color: #4f6078;
  cursor: default;
}

.pm-drop-panel button:focus-visible {
  outline: 2px solid #60a5fa;
  outline-offset: -2px;
}

.pm-drop-panel__toolbar-actions button {
  padding: 3px 6px;
}

.pm-drop-panel__icon-button {
  min-width: 28px;
  padding: 5px;
}

.pm-drop-panel__monitor-button {
  padding: 4px 6px;
  color: #94a3b8 !important;
  font-size: 11px !important;
  border: 1px solid rgba(100, 116, 139, 0.45) !important;
  border-radius: 4px;
}

.pm-drop-panel__monitor-button.is-active {
  color: #6ee7b7 !important;
  border-color: rgba(52, 211, 153, 0.45) !important;
}

.pm-drop-panel button:hover:not(:disabled) {
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 5px;
}

.pm-drop-panel__settings {
  flex: none;
  flex-wrap: wrap;
  gap: 8px 12px;
  padding: 7px 12px;
  font-size: 11px;
  color: #9fb0c7;
  background: rgba(10, 15, 24, 0.55);
}

.pm-drop-panel__settings--range {
  padding-top: 0;
  border-bottom: 1px solid rgba(91, 112, 145, 0.15);
}

.pm-drop-panel__settings--range input[type="number"] {
  width: 58px;
}

.pm-drop-panel__settings--range small {
  margin-left: auto;
  color: #65768e;
}

.pm-drop-panel__settings label {
  display: flex;
  gap: 5px;
  align-items: center;
}

.pm-drop-panel__settings input,
.pm-drop-panel__settings select {
  width: 48px;
  padding: 3px 4px;
  color: #e7edf7;
  text-align: right;
  background: #172235;
  border: 1px solid #394b66;
  border-radius: 4px;
  outline: none;
  font: inherit;
}

.pm-drop-panel__settings select {
  width: 54px;
  text-align: left;
}

.pm-drop-panel__settings input:focus,
.pm-drop-panel__settings select:focus {
  border-color: #60a5fa;
}

.pm-drop-panel__settings em {
  font-style: normal;
}

.pm-drop-panel__observe-only {
  color: #fbbf24;
}

.pm-drop-panel__body {
  flex: 1;
  min-height: 0;
  padding: 10px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: #394b66 transparent;
}

.pm-drop-panel__empty {
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

.pm-drop-panel__notice {
  margin-bottom: 8px;
  padding: 6px 8px;
  color: #fbbf24;
  font-size: 11px;
  background: rgba(251, 191, 36, 0.08);
  border: 1px solid rgba(251, 191, 36, 0.2);
  border-radius: 5px;
}

.pm-drop-panel__empty strong {
  color: #c6d2e3;
  font-size: 13px;
}

.pm-drop-signal {
  margin-bottom: 8px;
  padding: 10px;
  background: rgba(23, 32, 47, 0.65);
  border: 1px solid rgba(91, 112, 145, 0.3);
  border-radius: 7px;
}

.pm-drop-signal.is-locatable {
  cursor: pointer;
}

.pm-drop-signal.is-locatable:hover {
  background: rgba(96, 165, 250, 0.08);
}

.pm-drop-signal:last-child {
  margin-bottom: 0;
}

.pm-drop-signal:first-of-type {
  border-color: rgba(96, 165, 250, 0.5);
  background: rgba(96, 165, 250, 0.07);
}

.pm-drop-signal__topline {
  gap: 8px;
  justify-content: space-between;
}

.pm-drop-signal__topline strong {
  overflow: hidden;
  color: #9fb0c7;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pm-drop-signal__drop {
  flex: none;
  color: #fb7185;
  font-weight: 700;
  padding: 2px 6px;
  font-size: 11px;
  background: rgba(251, 113, 133, 0.1);
  border-radius: 4px;
}

.pm-drop-signal__match,
.pm-drop-signal__market {
  overflow-wrap: anywhere;
}

.pm-drop-signal__match {
  margin-top: 7px;
  color: #d7e2f0;
  font-size: 13px;
}

.pm-drop-signal__market {
  margin-top: 2px;
  color: #7f91aa;
  font-size: 11px;
}

.pm-drop-signal__prices {
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 8px;
  font-variant-numeric: tabular-nums;
}

.pm-drop-signal__prices b {
  color: #687991;
}

.pm-drop-signal__prices .is-current {
  color: #fb7185;
  font-weight: 700;
}

.pm-drop-signal__prices small {
  flex-basis: 100%;
  color: #6f8098;
}

.pm-drop-signal__ev-grid {
  display: grid;
  grid-template-columns: minmax(42px, 0.65fr) minmax(78px, 1fr) minmax(92px, 1.2fr);
  margin-top: 8px;
  overflow: hidden;
  color: #b8c6d9;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  background: rgba(8, 13, 22, 0.46);
  border: 1px solid rgba(91, 112, 145, 0.25);
  border-radius: 5px;
}

.pm-drop-signal__ev-grid > * {
  padding: 4px 7px;
  border-top: 1px solid rgba(91, 112, 145, 0.18);
}

.pm-drop-signal__ev-grid > :nth-child(-n + 3) {
  border-top: 0;
}

.pm-drop-signal__ev-grid .is-header {
  color: #9fb0c7;
  background: rgba(21, 35, 52, 0.98);
}

.pm-drop-signal__ev-grid .is-benchmark,
.pm-drop-signal__ev-grid .is-empty {
  color: #70829b;
}

.pm-drop-signal__ev-grid .is-positive {
  color: #34d399;
  font-weight: 700;
}

.pm-drop-signal__ev-grid .is-negative {
  color: #fb7185;
}

.pm-drop-signal footer {
  gap: 10px;
  margin-top: 7px;
  color: #65768e;
  font-size: 11px;
  flex-wrap: wrap;
  padding-top: 5px;
  border-top: 1px solid rgba(91, 112, 145, 0.2);
}

.pm-drop-signal footer time {
  margin-left: auto;
}

.pm-drop-panel__footer {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  flex: none;
  gap: 4px 8px;
  padding: 7px 20px 7px 12px;
  color: #7f91aa;
  font-size: 10px;
  background: rgba(10, 15, 24, 0.55);
  border-top: 1px solid rgba(91, 112, 145, 0.2);
}

.pm-drop-panel__resize-handle {
  position: absolute;
  right: 1px;
  bottom: 1px;
  width: 18px;
  height: 18px;
  cursor: nwse-resize !important;
  touch-action: none;
}

.pm-drop-panel__resize-handle::after {
  position: absolute;
  right: 4px;
  bottom: 4px;
  width: 8px;
  height: 8px;
  content: "";
  border-right: 2px solid #71829a;
  border-bottom: 2px solid #71829a;
}
</style>
