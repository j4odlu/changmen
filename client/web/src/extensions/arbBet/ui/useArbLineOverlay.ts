import type { MaybeRefOrGetter, Ref, WatchSource } from "vue";
import type { ArbLineBadge, ArbLineSegment } from "@/extensions/arbBet/ui/arb_line";
import type { BetSide } from "@/models/match";
import type { PlatformId } from "@/types/esport";
import { computed, onMounted, onUnmounted, ref, toValue, watch } from "vue";
import {

  computeArbLineOverlay,
  oddsAnchorKey,
  resolveVueElement,
} from "@/extensions/arbBet/ui/arb_line";

/** 登记赔率格 DOM，供套利划线取 anchor */
export function useOddsAnchorMap() {
  const map = new Map<string, HTMLElement>();
  const binders = new Map<string, (el: unknown) => void>();
  const version = ref(0);

  function bind(type: PlatformId, side: BetSide, itemId: string) {
    const key = oddsAnchorKey(type, side, itemId);
    const existing = binders.get(key);
    if (existing) return existing;
    const binder = (el: unknown) => {
      const node = resolveVueElement(el);
      if (node && map.get(key) !== node) { map.set(key, node); version.value++; }
      else if (!node && map.delete(key)) version.value++;
    };
    binders.set(key, binder);
    return binder;
  }

  function get(type: PlatformId, side: BetSide, itemId: string): HTMLElement | undefined {
    return map.get(oddsAnchorKey(type, side, itemId));
  }

  return { bind, get, version };
}

/**
 * 在 container 内根据两腿 anchor 刷新套利连线几何（ResizeObserver + watch）。
 */
export function useArbLineOverlay(
  containerRef: Ref<HTMLElement | null>,
  resolveAnchors: () => {
    home: HTMLElement | undefined | null;
    away: HTMLElement | undefined | null;
  } | null,
  watchSources: WatchSource[],
  enabled: MaybeRefOrGetter<boolean> = true,
) {
  const active = computed(() => toValue(enabled) !== false);
  const line = ref<ArbLineSegment | null>(null);
  const badge = ref<ArbLineBadge | null>(null);
  let frame: number | null = null;
  let disposed = false;

  // 只在 UI 帧测量 DOM；同帧多次检测/布局变化合并，不让业务等待绘图。
  function scheduleRefresh() {
    if (disposed || !active.value || frame !== null || typeof requestAnimationFrame !== "function") return;
    frame = requestAnimationFrame(() => { frame = null; refresh(); });
  }

  function cancelRefresh() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  }

  function clearOverlay() {
    line.value = null;
    badge.value = null;
  }

  function refresh() {
    if (!active.value) {
      clearOverlay();
      return;
    }
    const root = containerRef.value;
    if (!root) {
      clearOverlay();
      return;
    }
    const anchors = resolveAnchors();
    if (!anchors) {
      clearOverlay();
      return;
    }
    const geom = computeArbLineOverlay(root, anchors.home, anchors.away);
    if (!geom) {
      clearOverlay();
      return;
    }
    line.value = geom.line;
    badge.value = geom.badge;
  }

  let resizeObserver: ResizeObserver | null = null;

  onMounted(() => {
    resizeObserver = new ResizeObserver(scheduleRefresh);
    syncObserver(containerRef.value);
    scheduleRefresh();
  });

  function syncObserver(el: HTMLElement | null) {
    resizeObserver?.disconnect();
    if (!active.value || !el || !resizeObserver)
      return;
    resizeObserver.observe(el);
  }

  watch(
    containerRef,
    (el) => {
      syncObserver(el);
      scheduleRefresh();
    },
    { immediate: true, flush: "post" },
  );

  watch(active, (on) => {
    if (!on) {
      resizeObserver?.disconnect();
      cancelRefresh();
      clearOverlay();
      return;
    }
    syncObserver(containerRef.value);
    scheduleRefresh();
  }, { flush: "post" });

  onUnmounted(() => {
    disposed = true;
    cancelRefresh();
    resizeObserver?.disconnect();
    resizeObserver = null;
  });

  watch(watchSources, scheduleRefresh, { flush: "post" });

  return { line, badge, refresh };
}
