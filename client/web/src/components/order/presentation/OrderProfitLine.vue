<script setup lang="ts">
// Display strings are prepared by the order controller; no financial rules live here.
defineProps<{
  amountLabel: string;
  amountText: string;
  profitText: string;
  livePnlText?: string | null;
  livePnlTone?: "positive" | "negative" | "neutral";
}>();
</script>

<template>
  <div class="order__profit-line">
    {{ amountLabel }}：<slot name="amount">{{ amountText }}</slot>
    盈亏：{{ profitText }}
    <span
      v-if="livePnlText"
      class="order__live-pnl"
      :class="{ pos: livePnlTone === 'positive', neg: livePnlTone === 'negative' }"
    >{{ livePnlText }}</span>
  </div>
</template>
