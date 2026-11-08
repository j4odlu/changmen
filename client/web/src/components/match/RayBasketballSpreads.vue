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
function quote(option: RayBasketballSpreadOption | null): number {
  return option ? odds.getOdds("RAY", option.id) : 0;
}
</script>

<template>
  <section
    v-for="row in snapshot?.rows ?? []" :key="row.key" class="bet ray-basketball-spread"
    :aria-label="`RAY 篮球全场让分 主 ${row.home?.line ?? '—'} / 客 ${row.away?.line ?? '—'}`"
  >
    <div class="bet-title">[全场] 让分（主 {{ row.home?.line ?? '—' }} / 客 {{ row.away?.line ?? '—' }}，含加时）</div>
    <div class="item flex">
      <PlatformIcon class="item-type" platform="RAY" />
      <div
        v-for="side in sides" :key="side" class="item-odds" :class="[side, { lock: !quote(row[side]) }]"
        :data-ray-spread-odd-id="row[side]?.id" :title="`RAY · ${side === 'home' ? homeName : awayName} · ${row[side]?.line ?? '缺少选项'}`"
      >
        <span>{{ quote(row[side]) || '' }}</span>
      </div>
    </div>
  </section>
</template>
