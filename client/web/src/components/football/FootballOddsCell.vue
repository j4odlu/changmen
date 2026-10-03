<script setup lang="ts">
/**
 * 足球赔率格：按 oddId 读 sportOddsStore，不订全局 tick，不读电竞 fo。
 * 双击 OB 格 → 用 POD 跟单金额/账号手动下单。
 */
import { confirmPlaceRaySportBoardBet } from "@/runtime/raySportBoardPlace";
import { computed, ref } from "vue";
import { confirmPlaceObSportBoardBet } from "@/runtime/obSportBoardPlace";
import { confirmPlacePmSportBoardBet } from "@/runtime/pmSportBoardPlace";
import { resolveFootballCellOdds } from "@/runtime/footballMarketRows";
import { useSportOddsStore } from "@/stores/sportOddsStore";

const props = withDefaults(defineProps<{
  venue?: string;
  oddId?: string;
  fallback?: number;
  compact?: boolean;
  label?: string;
  side?: string;
  mid?: string;
  venueMid?: string;
  betId?: string;
  marketCode?: string;
  line?: number | null;
  home?: string;
  away?: string;
}>(), {
  fallback: 0,
  compact: false,
  line: null,
});

const sportOdds = useSportOddsStore();
const busy = ref(false);

const display = computed(() => resolveFootballCellOdds(
  props.venue || "OB",
  String(props.oddId || ""),
  Number(props.fallback) || 0,
  {
    get: (p, id) => sportOdds.get(p, id),
    has: (p, id) => sportOdds.has(p, id),
  },
));

const text = computed(() => {
  const n = display.value.odds;
  return n > 0 ? String(n) : "-";
});

const locked = computed(() => !(display.value.odds > 0));

const canPlace = computed(() => {
  const venue = String(props.venue || "OB").trim().toUpperCase() || "OB";
  return (venue === "OB" || venue === "POLYMARKET" || venue === "RAY")
    && !!String(props.oddId || "").trim()
    && !locked.value;
});

async function onDblClick(ev: MouseEvent) {
  ev.preventDefault();
  ev.stopPropagation();
  if (!canPlace.value || busy.value)
    return;
  busy.value = true;
  try {
    const venue = String(props.venue || "OB").trim();
    const venueKey = venue.toUpperCase();
    const input = {
      oid: String(props.oddId || "").trim(),
      mid: String(props.mid || "").trim(),
      venueMid: String(props.venueMid || "").trim(),
      betId: String(props.betId || "").trim(),
      odds: Number(display.value.odds) || 0,
      boardSide: String(props.side || "").trim(),
      marketCode: String(props.marketCode || "").trim(),
      line: props.line,
      home: String(props.home || "").trim(),
      away: String(props.away || "").trim(),
    };
    if (venueKey === "RAY")
      await confirmPlaceRaySportBoardBet(input);
    else if (venueKey === "POLYMARKET")
      await confirmPlacePmSportBoardBet(input);
    else
      await confirmPlaceObSportBoardBet(input);
  }
  finally {
    busy.value = false;
  }
}
</script>

<template>
  <div
    class="fb-sec__cell"
    :class="{
      lock: locked,
      'fb-sec__cell--sm': compact,
      'fb-sec__cell--bet': canPlace,
      'is-busy': busy,
    }"
    :data-odd-id="oddId || undefined"
    :data-pod-side="side || undefined"
    :data-pod-venue="venue || undefined"
    :title="canPlace ? '双击下单' : undefined"
    @dblclick="onDblClick"
  >
    <span v-if="label" class="fb-sec__lab">{{ label }}</span>
    <span class="fb-sec__odd">
      {{ text }}<span
        class="odds-src"
        :class="display.source === 'M' ? 'odds-src--m' : 'odds-src--h'"
      >{{ display.source }}</span>
    </span>
  </div>
</template>

<style scoped>
.fb-sec__cell {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 28px;
  min-width: 48px;
  padding: 4px 6px;
  border-radius: 6px;
  background: hsla(210, 40%, 50%, 0.16);
  border: 1px solid hsla(210, 40%, 70%, 0.18);
  user-select: none;
}
.fb-sec__cell--bet {
  cursor: pointer;
}
.fb-sec__cell--bet:hover:not(.lock) {
  border-color: #f59e0b99;
  background: hsla(38, 90%, 45%, 0.22);
}
.fb-sec__cell--bet.is-busy {
  opacity: 0.7;
  pointer-events: none;
}
.fb-sec__cell--sm {
  flex-direction: column;
  justify-content: center;
  min-height: 42px;
}
.fb-sec__lab {
  font-size: 11px;
  color: hsla(0, 0%, 100%, 0.62);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fb-sec__odd {
  font-size: 13px;
  font-weight: 700;
  color: #fff;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}
.odds-src {
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
  vertical-align: super;
  margin-left: 2px;
}
.odds-src--m {
  color: #86efac;
}
.odds-src--h {
  color: #94a3b8;
}
.fb-sec__cell.lock {
  opacity: 0.45;
  cursor: default;
}
.fb-sec__cell.is-pod-flash {
  outline: 2px solid #fde68a;
  box-shadow: 0 0 0 3px #fde68a55;
}
</style>
