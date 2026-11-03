<script setup lang="ts">
import type { ViewMatch } from "@changmen/client-core/models/match";
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from "vue";
import { TREND_GAP_MS, TREND_WINDOW_MS, trendPath, type PricePoint } from "./history";
import { priceTrendRuntime } from "./runtime";
import { resolveTrendTarget } from "./target";
import { observeTrendLayout } from "./layout";

const props = defineProps<{ match: ViewMatch }>();
const target = computed(() => resolveTrendTarget(props.match));
const frame = shallowRef<{ now: number; home: PricePoint[]; away: PricePoint[] }>({ now: Date.now(), home: [], away: [] });
const hoverAt = ref<number | null>(null);
const element = ref<HTMLElement>();
const layout = shallowRef({ height: 132, wrapped: false });
const compact = computed(() => layout.value.height < 90);
const plotHeight = computed(() => Math.max(12, layout.value.height - 14 - 16 - (compact.value ? 0 : 16) - 24));
let release: (() => void) | undefined;
let stopWatch: (() => void) | undefined;
let stopLayoutWatch: (() => void) | undefined;
let stopTargetLayoutWatch: (() => void) | undefined;
let sizeObserver: ReturnType<typeof observeTrendLayout> | undefined;
let mounted = false;

function refresh() {
  const now = Date.now();
  const current = target.value;
  frame.value = {
    now,
    home: current ? priceTrendRuntime.read(current.homeId, now) : [],
    away: current ? priceTrendRuntime.read(current.awayId, now) : [],
  };
}

onMounted(() => {
  mounted = true;
  const bindLayout = () => {
    sizeObserver?.stop(); sizeObserver = undefined;
    if (element.value) sizeObserver = observeTrendLayout(element.value, value => { layout.value = value; });
  };
  stopTargetLayoutWatch = watch(() => Boolean(target.value), async () => {
    await nextTick(); if (mounted) bindLayout();
  });
  stopLayoutWatch = watch(() => props.match.bets.map(bet => bet.id).join(","), () => sizeObserver?.refresh(), { flush: "post" });
  bindLayout();
  stopWatch = watch(() => target.value?.key, () => {
    release?.(); release = undefined;
    hoverAt.value = null;
    if (target.value)
      release = priceTrendRuntime.observe([target.value.homeId, target.value.awayId], refresh);
    refresh();
  }, { immediate: true, flush: "sync" });
});
onUnmounted(() => { mounted = false; stopWatch?.(); release?.(); stopLayoutWatch?.(); stopTargetLayoutWatch?.(); sizeObserver?.stop(); });

const homePath = computed(() => trendPath(frame.value.home, frame.value.now, plotHeight.value));
const awayPath = computed(() => trendPath(frame.value.away, frame.value.now, plotHeight.value));
const hasData = computed(() => frame.value.home.length > 0 || frame.value.away.length > 0);
const stale = computed(() => !hasData.value || frame.value.now - Math.min(
  frame.value.home.at(-1)?.at ?? 0, frame.value.away.at(-1)?.at ?? 0,
) > TREND_GAP_MS);
const hover = computed(() => {
  if (hoverAt.value === null) return null;
  const at = frame.value.now - TREND_WINDOW_MS + hoverAt.value * TREND_WINDOW_MS;
  const nearest = (points: PricePoint[]) => {
    const point = points.reduce<PricePoint | undefined>((best, point) =>
      !best || Math.abs(point.at - at) < Math.abs(best.at - at) ? point : best, undefined);
    return point && Math.abs(point.at - at) <= 5_000 ? point : undefined;
  };
  return { at, home: nearest(frame.value.home), away: nearest(frame.value.away) };
});
const hoverX = computed(() => 28 + (hoverAt.value ?? 0) * 280);
const tooltipLeft = computed(() => Math.max(0, Math.min(140, hoverX.value - 80)));
function move(event: MouseEvent) {
  const rect = (event.currentTarget as SVGSVGElement).getBoundingClientRect();
  if (rect.width > 0)
    hoverAt.value = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width * 320 / 280 - 28 / 280));
}
function priceText(point?: PricePoint) { return point ? `${(point.price * 100).toFixed(1)}¢` : "—"; }
function oddsText(point?: PricePoint) { return point ? (1 / point.price).toFixed(3) : "—"; }
function timeText(at: number) { return new Date(at).toLocaleTimeString("zh-CN", { hour12: false }); }
</script>

<template>
  <section v-if="target" ref="element" class="pm-price-trend" :class="{ 'pm-price-trend--compact': compact }"
    :style="{ height: layout.wrapped ? `${layout.height}px` : undefined }" aria-label="当前地图 PM 价格趋势">
    <header>
      <strong>地图{{ target.round }} · PM 走势</strong>
      <span :title="stale ? '等待双方最新行情；空白时段不连线' : '双方实时可买入价，不含手续费'">{{ stale ? '等待更新' : '买入价' }}</span>
    </header>
    <div class="pm-price-trend__legend">
      <span class="pm-price-trend__home" :title="target.homeName">{{ target.homeName }} {{ priceText(frame.home.at(-1)) }}</span>
      <span class="pm-price-trend__away" :title="target.awayName">{{ target.awayName }} {{ priceText(frame.away.at(-1)) }}</span>
    </div>
    <svg v-if="layout.height >= 70" :viewBox="`0 0 320 ${plotHeight + 24}`" preserveAspectRatio="none" role="img" aria-label="最近三十分钟双方 PM 买入价格，纵轴为美分" @mousemove="move" @mouseleave="hoverAt = null">
      <g class="pm-price-trend__grid">
        <path :d="`M28 4H308 M28 ${4 + plotHeight / 2}H308 M28 ${4 + plotHeight}H308`" />
        <text x="0" y="9">100¢</text><text x="6" :y="8 + plotHeight / 2">50¢</text><text x="12" :y="7 + plotHeight">0¢</text>
        <text x="28" :y="20 + plotHeight">{{ timeText(frame.now - TREND_WINDOW_MS) }}</text>
        <text x="308" :y="20 + plotHeight" text-anchor="end">{{ timeText(frame.now) }}</text>
      </g>
      <g transform="translate(28 4)">
        <path :d="homePath" class="pm-price-trend__line pm-price-trend__home" />
        <path :d="awayPath" class="pm-price-trend__line pm-price-trend__away" />
        <circle v-for="(point, i) in [frame.home.at(-1), frame.away.at(-1)]" v-show="point" :key="i"
          :cx="point ? (point.at - frame.now + TREND_WINDOW_MS) / TREND_WINDOW_MS * 280 : 0"
          :cy="point ? (1 - point.price) * plotHeight : 0" r="2" :class="i === 0 ? 'pm-price-trend__home' : 'pm-price-trend__away'" />
      </g>
      <path v-if="hover" :d="`M${hoverX} 4V${4 + plotHeight}`" class="pm-price-trend__cursor" />
      <text v-if="!hasData" x="168" :y="8 + plotHeight / 2" text-anchor="middle" class="pm-price-trend__empty">等待实时行情</text>
    </svg>
    <div v-if="hover" class="pm-price-trend__tooltip" :style="{ left: `${tooltipLeft}px` }">
      {{ timeText(hover.at) }}
      <div class="pm-price-trend__home">{{ target.homeName }} {{ priceText(hover.home) }} · 赔率 {{ oddsText(hover.home) }} <small v-if="hover.home">{{ timeText(hover.home.at) }}</small></div>
      <div class="pm-price-trend__away">{{ target.awayName }} {{ priceText(hover.away) }} · 赔率 {{ oddsText(hover.away) }} <small v-if="hover.away">{{ timeText(hover.away.at) }}</small></div>
    </div>
  </section>
</template>

<style scoped>
.pm-price-trend { position: relative; display: flex; flex-direction: column; flex: 0 0 320px; align-self: stretch; contain: size; overflow: hidden; box-sizing: border-box; width: 320px; max-width: 100%; height: auto; margin: 0 10px 10px 0; padding: 6px; border: 1px solid var(--el-border-color, #626775); border-radius: 6px; background: var(--el-bg-color, #20232c); color: var(--el-text-color-primary, #dce0e8); font-size: 11px; line-height: 16px; }
header { display: flex; flex: 0 0 16px; align-items: center; justify-content: space-between; gap: 8px; height: 16px; }
header span { opacity: .65; font-size: 10px; }
.pm-price-trend__legend { display: flex; flex: 0 0 16px; gap: 10px; height: 16px; }
.pm-price-trend--compact .pm-price-trend__legend { display: none; }
.pm-price-trend__legend span { flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
svg { display: block; flex: 1 1 0; min-height: 0; width: 100%; height: auto; overflow: hidden; touch-action: pan-y; }
.pm-price-trend__grid { fill: currentColor; font-size: 8px; opacity: .5; }
.pm-price-trend__grid path { stroke: currentColor; stroke-width: .5; fill: none; }
.pm-price-trend__line { fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linejoin: round; }
.pm-price-trend__home { color: #3498ed; }
.pm-price-trend__away { color: #f0a23a; }
circle { fill: currentColor; }
.pm-price-trend__cursor { stroke: currentColor; stroke-width: .6; stroke-dasharray: 2 2; opacity: .6; }
.pm-price-trend__empty { fill: currentColor; opacity: .6; font-size: 10px; }
.pm-price-trend__tooltip { position: absolute; z-index: 3; top: 36px; max-width: 290px; padding: 5px 7px; border: 1px solid var(--el-border-color, #626775); border-radius: 4px; background: var(--el-bg-color, #20232c); pointer-events: none; font-size: 10px; }
.pm-price-trend__tooltip div { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
</style>
