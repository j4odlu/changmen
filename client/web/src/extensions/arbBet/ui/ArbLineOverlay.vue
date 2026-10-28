<script setup lang="ts">
import type { ArbLineBadge, ArbLineSegment } from "@/extensions/arbBet/ui/arb_line";

defineProps<{
  line: ArbLineSegment | null;
  badge: ArbLineBadge | null;
  label?: string;
  /** PM 角标占用赔率右侧时，将利润放到盘口标题旁。 */
  badgePosition?: "anchor" | "header";
}>();
</script>

<template>
  <svg v-if="line" class="arb-lines" aria-hidden="true">
    <line :x1="line.x1" :y1="line.y1" :x2="line.x2" :y2="line.y2" />
  </svg>
  <div
    v-if="line && badge && label"
    class="arb-profit-badge"
    :style="badgePosition === 'header'
      ? { right: '26px', top: '-20px', transform: 'none', fontSize: '9px', padding: '1px 4px' }
      : { left: `${badge.x}px`, top: `${badge.y}px` }"
  >
    {{ label }}
  </div>
</template>
