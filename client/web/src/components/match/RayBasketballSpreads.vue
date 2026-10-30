<script setup lang="ts">
import { computed } from "vue";
import type { ViewMatch } from "@/models/match";
import { getRayBasketballSpreads, type RayBasketballSpreadOption } from "@changmen/venue-browser/adapter/ray/markets";
import PlatformIcon from "@/components/platform/PlatformIcon.vue";
import { useOddsStore } from "@/stores/oddsStore";

const props = defineProps<{ match: ViewMatch; homeName: string; awayName: string }>();
const odds = useOddsStore();
const snapshot = computed(() => getRayBasketballSpreads(String(props.match.providers.RAY), props.match.reverse.includes("RAY")));
const sides = ["home", "away"] as const;
function quote(option: RayBasketballSpreadOption | null): string {
  if (!option)
    return "—";
  const entry = odds.getEntry("RAY", option.id);
  if (!entry)
    return "等待报价";
  if (entry.isLock)
    return option.status === 5 ? "已结束" : "锁盘";
  return odds.getOdds("RAY", option.id) > 0 ? String(odds.getOdds("RAY", option.id)) : "等待报价";
}
</script>

<template>
  <section
    v-for="row in snapshot?.rows ?? []" :key="row.key" class="bet ray-basketball-spread"
    :aria-label="`RAY 篮球全场让分 主 ${row.home?.line ?? '—'} / 客 ${row.away?.line ?? '—'}`"
  >
    <div class="bet-title">[全场] 让分（主 {{ row.home?.line ?? '—' }} / 客 {{ row.away?.line ?? '—' }}，含加时）</div>
    <div class="spread-teams">
      <span :title="homeName">{{ homeName }}</span>
      <span :title="awayName">{{ awayName }}</span>
    </div>
    <div class="item flex">
      <PlatformIcon class="item-type" platform="RAY" />
      <div
        v-for="side in sides" :key="side" class="item-odds spread-price" :class="side"
        :data-ray-spread-odd-id="row[side]?.id" :title="`RAY · ${side === 'home' ? homeName : awayName} · ${row[side]?.line ?? '缺少选项'}`"
      >
        <span class="spread-line">{{ row[side]?.line ?? '—' }}</span>
        <span>{{ quote(row[side]) }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.spread-teams {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 6px;
  padding: 0 3px 5px 28px;
  font-size: 11px;
  text-align: center;
}
.spread-teams span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.spread-price { display: flex !important; align-items: center; justify-content: space-around; gap: 5px; }
.spread-line { opacity: 0.8; font-size: 11px; }
</style>
