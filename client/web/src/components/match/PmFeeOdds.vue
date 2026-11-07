<script setup lang="ts">
import { computed, onMounted, onUnmounted, shallowRef, watch } from "vue";
import type { PolymarketMarketFeeDetails } from "@changmen/venue-browser/polymarket/orders/pmFee";
import { loadPmDisplayFee } from "@/services/pmDisplayFees";
import { pmFeeAdjustedOdds } from "@/shared/pmFeeOddsDisplay";

/** [changmen 扩展] 旁显组件不写行情、不改点击事件或传给交易链路的赔率。 */
const props = defineProps<{ conditionId: string; price?: number }>();
const fee = shallowRef<PolymarketMarketFeeDetails>();
const refresh = shallowRef(0);
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => { timer = setInterval(() => { refresh.value++; }, 60_000); });
onUnmounted(() => { clearInterval(timer); });
watch(() => [props.conditionId, refresh.value] as const, async ([id], previous, onCleanup) => {
  let current = true;
  onCleanup(() => { current = false; });
  if (id !== previous?.[0]) fee.value = undefined;
  const details = await loadPmDisplayFee(id);
  if (current) fee.value = details;
}, { immediate: true });
const label = computed(() => pmFeeAdjustedOdds(props.price, fee.value) ?? "—");
const title = computed(() => [
  "扣费后折算赔率（taker 估算），与左侧使用同档价格；左侧含价格缓冲时，此值也含缓冲。仅供参考。",
  fee.value ? `盘口费率参数：${fee.value.feeRate}。` : "手续费参数待更新或暂不支持。",
].join(""));
</script>

<template>
  <span class="pm-fee-odds" :title="title">{{ ` / ${label}` }}</span>
</template>

<style scoped>
.pm-fee-odds {
  display: inline;
  white-space: nowrap;
  font-size: 11px;
  opacity: .8;
}
</style>
