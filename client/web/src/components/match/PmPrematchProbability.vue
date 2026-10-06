<script setup lang="ts">
import type { ViewBet } from "@/models/match";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { formatOrderTime } from "@changmen/client-core/shared/format";
import { loadPrematchProbability, type PrematchProbability } from "@/shared/pmPrematchProbability";

const props = defineProps<{ bet: ViewBet }>();
const pm = computed(() => props.bet.items.find(item => item.type === "Polymarket"));

const value = ref<PrematchProbability | null>(null);
const status = ref("等待查询");
const host = ref<HTMLElement>();
const visible = ref(false);
const clock = ref(0);
let generation = 0;
let timer: ReturnType<typeof setInterval> | undefined;
let observer: IntersectionObserver | undefined;

watch(() => [pm.value?.homeId, pm.value?.awayId, visible.value, clock.value] as const, async ([home, away, shown], previous) => {
  const current = ++generation;
  if (home !== previous?.[0] || away !== previous?.[1]) {
    value.value = null;
    status.value = "等待查询";
  }
  if (!shown || !home || !away)
    return;
  status.value = "查询中";
  try {
    const result = await loadPrematchProbability(home, away);
    if (current !== generation)
      return;
    value.value = result.status === "ready" ? result.value : null;
    status.value = result.status === "pending" ? "等待登记开赛时间" : result.status === "missing" ? "暂无历史数据" : "";
  }
  catch {
    if (current === generation) {
      value.value = null;
      status.value = "查询失败，稍后重试";
    }
  }
}, { immediate: true });

onMounted(() => {
  timer = setInterval(() => { clock.value++; }, 60_000);
  observer = new IntersectionObserver(([entry]) => { visible.value = entry?.isIntersecting ?? false; }, { rootMargin: "100px" });
  if (host.value) observer.observe(host.value);
});
watch(host, (element, previous) => {
  if (previous) observer?.unobserve(previous);
  if (element) observer?.observe(element);
});
onUnmounted(() => {
  generation++;
  clearInterval(timer);
  observer?.disconnect();
});

/** [changmen 扩展] 临时采用登记时间口径，不标作实际清单前最后价。 */
const detail = computed(() => value.value
  ? `C · ${props.bet.getBetName()} · PM 登记开赛时间前价格，非实际清单确认价。取价截止：${formatOrderTime(value.value.cutoff)}；${props.bet.homeName}记录：${formatOrderTime(value.value.homeTime)}；${props.bet.awayName}记录：${formatOrderTime(value.value.awayTime)}；采样窗口 ${value.value.resolution} 秒。`
  : `C · ${props.bet.getBetName()} · ${status.value}；按 PM 登记开赛时间前 1 秒查询该盘口历史价格。`);
</script>

<template>
  <div v-if="pm" ref="host" class="item flex pm-prematch" :title="detail" @dblclick.stop>
    <div class="item-type pm-prematch-badge" aria-label="C：PM 登记开赛时间前胜率">C</div>
    <div class="item-odds home" :aria-label="`${bet.homeName}：${value ? `${value.home.toFixed(1)}%` : status}`">{{ value ? `${value.home.toFixed(1)}%` : "—" }}</div>
    <div class="item-odds away" :aria-label="`${bet.awayName}：${value ? `${value.away.toFixed(1)}%` : status}`">{{ value ? `${value.away.toFixed(1)}%` : "—" }}</div>
  </div>
</template>
<style scoped>
.matchs .bet .bet-items .pm-prematch.item .item-odds {
  /* 沿用赔率格和当前主题背景，仅用主题强调色区分赛前参考值。 */
  color: var(--cm-color-warning, #e6a23c);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.matchs .bet .bet-items .pm-prematch.item .item-type.pm-prematch-badge {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  /* 与场馆徽标共用 24px 圆形、底色和间距。 */
  border-color: var(--cm-color-warning, #e6a23c);
  color: var(--cm-color-warning, #e6a23c);
  font-size: 12px;
  font-weight: 600;
}
</style>
