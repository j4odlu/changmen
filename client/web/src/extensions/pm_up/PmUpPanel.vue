<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import FloatingPanelLauncher from "@/components/FloatingPanelLauncher.vue";
import { useMatchStore } from "@/stores/matchStore";
import { useUserStore } from "@/stores/userStore";
import PmUpSignals from "./PmUpSignals.vue";
import { clearPmUpSignals, pmUpSignals, startPmUpMonitor } from "./runtime";
import { normalizePmUpPrefs } from "./settings";

const user = useUserStore();
const matchStore = useMatchStore();
const collapsed = ref(true);
const panelEl = ref<HTMLElement | null>(null);
const offset = ref<{ left: number; top: number } | null>(null);
const settings = computed(() => normalizePmUpPrefs(user.extensionPrefs.pmUp));
const panelStyle = computed(() => offset.value && !collapsed.value
  ? { left: `${offset.value.left}px`, top: `${offset.value.top}px`, right: "auto", bottom: "auto" } : {});
let stop: (() => void) | undefined;
let dragCleanup: (() => void) | undefined;

function onDrag(event: PointerEvent): void {
  if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
  const bounds = panelEl.value?.getBoundingClientRect();
  if (!bounds) return;
  event.preventDefault();
  dragCleanup?.();
  const move = (next: PointerEvent) => {
    offset.value = {
      left: Math.max(0, Math.min(window.innerWidth - bounds.width, bounds.left + next.clientX - event.clientX)),
      top: Math.max(0, Math.min(window.innerHeight - bounds.height, bounds.top + next.clientY - event.clientY)),
    };
  };
  const cleanup = () => {
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", cleanup);
    document.removeEventListener("pointercancel", cleanup);
    dragCleanup = undefined;
  };
  dragCleanup = cleanup;
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", cleanup);
  document.addEventListener("pointercancel", cleanup);
}

watch(() => [user.userId, settings.value] as const, ([userId, config]) => {
  stop?.();
  clearPmUpSignals();
  stop = userId && config.enabled ? startPmUpMonitor(config, () => matchStore.matchs) : undefined;
}, { immediate: true });

onUnmounted(() => { stop?.(); dragCleanup?.(); clearPmUpSignals(); });
</script>

<template>
  <aside ref="panelEl" class="pm-up-panel" :class="{ 'is-collapsed': collapsed }" :style="panelStyle" aria-label="pm_up 涨赔套利信号">
    <FloatingPanelLauncher
      v-if="collapsed" label="pm_up 涨赔信号" caption="pm_up" kind="odds-up"
      :count="pmUpSignals.length" :active="settings.enabled" @open="collapsed = false"
    />
    <template v-else>
      <header title="按住拖动" @pointerdown="onDrag">
        <strong>↑ pm_up 涨赔信号 <span>{{ pmUpSignals.length }}</span></strong>
        <button type="button" aria-label="收起 pm_up 涨赔信号" :aria-expanded="true" @click="collapsed = true">—</button>
      </header>
      <nav aria-label="pm_up 监测状态">
        <span>正在监听 PM 实时行情</span>
        <button type="button" :disabled="!pmUpSignals.length" @click="clearPmUpSignals">清空</button>
      </nav>
      <p class="pm-up-panel__settings">涨幅 ≥ {{ settings.minRisePct }}% · 套利 ≥ {{ settings.minArbPct }}% · 窗口 {{ settings.windowMs / 1000 }} 秒</p>
      <div class="pm-up-panel__body">
        <PmUpSignals v-if="pmUpSignals.length" :signals="pmUpSignals" show-match />
        <div v-else class="pm-up-panel__empty">
          <strong>正在监听 PM 新涨赔行情</strong>
          <span>同盘口对侧场馆出现套利时显示，首次报价只建立基线。</span>
        </div>
      </div>
      <footer><span>触发时快照 · 关注其他场馆对侧</span><b>仅观察 · 不自动下注</b></footer>
    </template>
  </aside>
</template>

<style scoped>
.pm-up-panel { position: fixed; right: 18px; bottom: 18px; z-index: 1250; display: flex; flex-direction: column; width: 500px; height: 560px; min-width: min(320px, calc(100vw - 24px)); min-height: min(260px, calc(100vh - 36px)); max-width: calc(100vw - 24px); max-height: calc(100vh - 36px); overflow: hidden; resize: both; box-sizing: border-box; border: 1px solid #5b7091a6; border-radius: 12px; background: var(--cm-body-bg-mid, #141b29); color: var(--paper-ink, var(--brutal-ink, var(--term-ink, #e7edf7))); font: 12px/1.5 system-ui, sans-serif; box-shadow: 0 14px 44px #0006; }
.pm-up-panel.is-collapsed { bottom: 164px; width: 56px !important; height: 56px !important; min-width: 0; min-height: 0; border: 0; background: transparent; overflow: visible; resize: none; box-shadow: none; }
.pm-up-panel header, .pm-up-panel nav, .pm-up-panel footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 12px; }
.pm-up-panel header { border-bottom: 1px solid #5b70914d; cursor: move; touch-action: none; user-select: none; }
.pm-up-panel header strong > span { margin-left: 6px; color: var(--cm-color-muted, #94a3b8); }
.pm-up-panel button { padding: 3px 8px; border: 1px solid #5b709180; border-radius: 4px; color: inherit; background: transparent; font: inherit; cursor: pointer; }
.pm-up-panel button:disabled { cursor: default; opacity: .45; }
.pm-up-panel button:focus-visible { outline: 2px solid var(--cm-color-primary, #409eff); outline-offset: 2px; }
.pm-up-panel nav { padding-bottom: 4px; }
.pm-up-panel__settings { margin: 0; padding: 4px 12px 10px; color: var(--cm-color-muted, #94a3b8); }
.pm-up-panel__body { flex: 1; min-height: 0; padding: 0 12px; overflow: auto; }
.pm-up-panel__empty { display: grid; gap: 8px; padding: 24px 4px; color: var(--cm-color-muted, #94a3b8); }
.pm-up-panel footer { border-top: 1px solid #5b70914d; flex-wrap: wrap; color: var(--cm-color-muted, #94a3b8); }
.pm-up-panel footer b { color: var(--cm-color-success, #67c23a); font-weight: 500; }
</style>
