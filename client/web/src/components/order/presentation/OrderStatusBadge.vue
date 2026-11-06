<script setup lang="ts">
defineProps<{ statusClass?: string }>();
</script>

<template>
  <label class="status" :class="statusClass" />
</template>
