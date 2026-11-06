<script setup lang="ts">
defineProps<{
  sharesText?: string | null;
  priceLabel?: string;
  priceText?: string | null;
  oddsText?: string;
  oddsTitle?: string;
  showOdds: boolean;
}>();
</script>

<template>
  <div class="order__profit-line">
    <span v-if="sharesText">份额：{{ sharesText }} </span>
    <span v-if="priceText">{{ priceLabel }}：{{ priceText }} </span>
    <span v-if="showOdds" :title="oddsTitle">赔率：<span class="order__odds">{{ oddsText }}</span></span>
  </div>
</template>
