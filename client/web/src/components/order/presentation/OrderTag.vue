<script setup lang="ts">
defineProps<{
  text?: string | null;
  className?: string;
  title?: string;
}>();
</script>

<template>
  <span class="order__pm-tag" :class="className" :title="title">{{ text }}</span>
</template>
