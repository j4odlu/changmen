<script setup lang="ts">
defineProps<{
  showPrice: boolean;
  showOdds: boolean;
  priceText: string;
  priceLabel?: string;
  oddsText: string;
}>();
</script>

<template>
  <span class="order__sell-row-meta">
    <span v-if="showPrice">{{ priceLabel ?? '当前价' }}：{{ priceText }} </span>
    <span v-if="showOdds">当前赔率：<span class="order__odds">{{ oddsText }}</span> </span>
  </span>
</template>
