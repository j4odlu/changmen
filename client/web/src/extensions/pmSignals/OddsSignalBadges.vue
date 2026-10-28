<script setup lang="ts">
import type { OddsSignalBadge } from "./oddsBadges";
import { revealSignal } from "./state";
defineProps<{ badges: readonly OddsSignalBadge[]; now: number }>();

function sortedPrices(movement: NonNullable<OddsSignalBadge["movement"]>) {
  const before = { phase: "before", odds: movement.beforeOdds };
  const after = { phase: "after", odds: movement.currentOdds };
  return before.odds >= after.odds ? [before, after] : [after, before];
}
</script>

<template>
  <span v-if="badges.length" class="pm-odds-badges">
    <button v-for="badge in badges" :key="`${badge.direction}:${badge.role}`" type="button" class="pm-odds-badge" :class="[`is-${badge.direction}`, { 'is-aging': now - badge.detectedAt >= 10000 }]" :title="badge.title" :aria-label="badge.title" @click.stop="revealSignal(badge.signalId)" @dblclick.stop @pointerdown.stop>
      <span v-if="badge.role === 'source' && badge.movement" class="pm-odds-badge__prices"><span v-for="price in sortedPrices(badge.movement)" :key="price.phase" class="pm-odds-badge__price">{{ price.odds.toFixed(3) }}</span></span>
      <span class="pm-odds-badge__metric"><span v-if="badge.role === 'source'" class="pm-odds-badge__arrow" aria-hidden="true">{{ badge.direction === 'down' ? '↓' : '↑' }}</span><span>{{ badge.role === 'source' ? badge.label.slice(1) : badge.label }}</span></span>
    </button>
  </span>
</template>

<style scoped>
.pm-odds-badges { position: relative; z-index: 4; display: inline-grid; flex: none; gap: 2px; align-content: center; max-width: 100px; vertical-align: middle; }
.pm-odds-badge { display: flex; align-items: center; justify-content: center; gap: 4px; box-sizing: border-box; min-width: 0; min-height: 18px; padding: 0 3px; border: 1px solid #d99b3659; border-radius: 3px; color: #9b6200; background: #fff0ce; font: 700 10px/1.3 system-ui, sans-serif; white-space: nowrap; cursor: pointer; font-variant-numeric: tabular-nums; }
.pm-odds-badge__metric { display: inline-flex; align-items: center; justify-content: center; gap: 1px; }
.pm-odds-badge__prices { display: grid; gap: 1px; padding: 2px 0; font-size: 10px; font-weight: 600; line-height: 1.3; }
.pm-odds-badge__price { text-align: right; }
.pm-odds-badge__arrow { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 12px; height: 16px; font-size: 20px; font-weight: 900; line-height: 1; }
.pm-odds-badge.is-up { border-color: #409eff66; color: #075cae; background: #e0efff; }
.pm-odds-badge.is-aging { opacity: .65; }
.pm-odds-badge:hover { opacity: 1; filter: brightness(.95); }
.pm-odds-badge:focus-visible { outline: 2px solid var(--el-color-primary, #409eff); outline-offset: 1px; }
</style>
