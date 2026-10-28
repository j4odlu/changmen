<script setup lang="ts">
/** [changmen 扩展] 只读浮窗默认以圆形入口显示，点击后展开。 */
defineProps<{
  label: string;
  caption: string;
  kind: "progress" | "odds" | "odds-up" | "odds-move";
  count: number;
  active: boolean;
}>();
defineEmits<{ open: [] }>();
</script>

<template>
  <button
    type="button"
    class="floating-panel-launcher"
    :title="`展开${label}`"
    :aria-label="`展开${label}`"
    :aria-expanded="false"
    @click="$emit('open')"
  >
    <svg v-if="kind === 'progress'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4V2h6v2M9 10h6M9 14h6M9 18h3" />
    </svg>
    <svg v-else-if="kind === 'odds-move'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M7 20V4m-4 4 4-4 4 4M17 4v16m-4-4 4 4 4-4" />
    </svg>
    <svg v-else-if="kind === 'odds-up'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="m4 18 6-6 4 4 6-9M14 7h6v6" />
    </svg>
    <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="m4 6 6 6 4-4 6 9M14 17h6v-6" />
    </svg>
    <span class="floating-panel-launcher__caption">{{ caption }}</span>
    <span v-if="count" class="floating-panel-launcher__count">{{ count > 99 ? '99+' : count }}</span>
    <span class="floating-panel-launcher__status" :class="{ 'is-active': active }" aria-hidden="true" />
  </button>
</template>

<style scoped>
.floating-panel-launcher.floating-panel-launcher {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  width: 56px;
  height: 56px;
  padding: 0;
  color: #ecfdf5;
  background: linear-gradient(145deg, #15803d, #166534);
  border: 1px solid rgba(110, 231, 183, .5);
  border-radius: 50%;
  box-shadow: 0 5px 18px rgba(0, 0, 0, .3);
  cursor: pointer;
}
.floating-panel-launcher.floating-panel-launcher:hover:not(:disabled) {
  color: #fff;
  background: linear-gradient(145deg, #16a34a, #15803d);
  border-radius: 50%;
}
.floating-panel-launcher.floating-panel-launcher:focus-visible {
  outline: 2px solid #93c5fd;
  outline-offset: 3px;
}
.floating-panel-launcher svg { width: 23px; height: 23px; }
.floating-panel-launcher__caption { font: 10px/1 system-ui, sans-serif; }
.floating-panel-launcher__count {
  position: absolute;
  top: -3px;
  right: -4px;
  min-width: 18px;
  padding: 0 4px;
  box-sizing: border-box;
  color: #e7edf7;
  font: 10px/18px system-ui, sans-serif;
  background: #26364e;
  border: 1px solid #5b7091;
  border-radius: 10px;
}
.floating-panel-launcher__status {
  position: absolute;
  right: 3px;
  bottom: 3px;
  width: 8px;
  height: 8px;
  background: #64748b;
  border: 2px solid #14251c;
  border-radius: 50%;
}
.floating-panel-launcher__status.is-active { background: #34d399; }
</style>
