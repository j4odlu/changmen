<script setup lang="ts">
defineProps<{
  matchText?: string;
  betText?: string;
  itemText?: string;
}>();
</script>

<template>
  <slot name="match"><div class="match">{{ matchText }}</div></slot>
  <div class="bet">
    <div class="betname"><slot name="bet"><span>{{ betText }}</span></slot></div>
    <div class="item"><label>{{ itemText }}</label></div>
  </div>
</template>
