<script setup lang="ts">
import { computed, ref } from "vue";
import { pmUpSignals } from "./runtime";
import PmUpSignals from "./PmUpSignals.vue";

const props = defineProps<{ matchId: number; betId: number }>();
const expanded = ref(false);
const signals = computed(() => pmUpSignals.value.filter(signal => signal.matchId === props.matchId && signal.betId === props.betId));
const visible = computed(() => expanded.value ? signals.value : signals.value.slice(0, 3));
</script>

<template>
  <section v-if="signals.length" class="match-pm-up" aria-label="pm_up 盘口信号">
    <div class="match-pm-up__heading">
      <strong>↑ pm_up 涨赔信号</strong>
      <span>触发时快照</span>
      <button v-if="signals.length > 3" type="button" :aria-expanded="expanded" @click="expanded = !expanded">
        {{ expanded ? '收起' : `展开全部 ${signals.length} 条` }}
      </button>
    </div>
    <PmUpSignals :signals="visible" />
  </section>
</template>

<style scoped>
.match-pm-up { margin: 0 0 8px; padding: 6px; border: 1px solid color-mix(in srgb, var(--cm-color-success, #67c23a) 50%, transparent); border-left: 3px solid var(--cm-color-success, #67c23a); border-radius: 6px; background: var(--cm-body-bg-mid, #18212b); color: var(--paper-ink, var(--brutal-ink, var(--term-ink, #e7edf7))); font-size: 11px; line-height: 1.6; }
.match-pm-up__heading { display: flex; flex-wrap: wrap; align-items: center; gap: 3px 6px; margin-bottom: 4px; }
.match-pm-up__heading > span { color: var(--cm-color-muted, #94a3b8); }
.match-pm-up__heading button { margin-left: auto; padding: 2px 4px; border: 0; background: transparent; color: var(--cm-color-primary, #409eff); font: inherit; cursor: pointer; }
</style>
