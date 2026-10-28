<script setup lang="ts">
import type { OddsSignal, SignalFilter } from "./presentation";
import { computed, nextTick, ref } from "vue";
import { filterSignals } from "./presentation";
import SignalCard from "./SignalCard.vue";

const props = defineProps<{ signals: readonly OddsSignal[]; now: number }>();
defineEmits<{ locate: [matchId: number] }>();
const filter = ref<SignalFilter>("all");
const listEl = ref<HTMLElement | null>(null);
const filters = [{ key: "all", label: "全部" }, { key: "down", label: "↓ 降赔" }, { key: "up", label: "↑ 涨赔" }] as const;
const filtered = computed(() => filterSignals(props.signals, filter.value));
async function reveal(id: string): Promise<void> {
  filter.value = "all";
  await nextTick();
  const card = listEl.value?.querySelector<HTMLElement>(`[data-signal-id="${CSS.escape(id)}"]`);
  card?.scrollIntoView({ block: "nearest" });
  if (card) {
    const details = card.querySelector("details");
    if (details) details.open = true;
    card.animate([{ outline: "2px solid #409eff" }, { outline: "2px solid transparent" }], { duration: 1600 });
  }
}
defineExpose({ reveal });
</script>

<template>
  <section ref="listEl" class="signal-list" aria-label="赔率异动信号">
    <nav class="signal-list__filters" aria-label="筛选赔率异动方向">
      <button v-for="tab in filters" :key="tab.key" type="button" :aria-pressed="filter === tab.key" @click="filter = tab.key">
        <span v-if="tab.key !== 'all'" class="signal-list__arrow" aria-hidden="true">{{ tab.key === 'down' ? '↓' : '↑' }}</span>{{ tab.key === 'all' ? tab.label : tab.label.slice(1) }} <span>{{ signals.filter(row => tab.key === 'all' || row.direction === tab.key).length }}</span>
      </button>
    </nav>
    <div class="signal-list__cards">
      <SignalCard v-for="signal in filtered" :key="signal.id" :signal="signal" :now="now" @locate="$emit('locate', $event)" />
    </div>
    <p v-if="!filtered.length" class="signal-list__empty">{{ filter === 'all' ? '等待符合条件的新信号' : filter === 'down' ? '暂无降赔信号' : '暂无涨赔信号' }}</p>
  </section>
</template>

<style scoped>
.signal-list { min-width: 0; }
.signal-list__filters { display: flex; flex-wrap: wrap; gap: 4px; padding-bottom: 8px; }
.signal-list__filters button { display: inline-flex; align-items: center; gap: 3px; padding: 4px 9px; border: 1px solid transparent; border-radius: 5px; background: transparent; color: var(--el-text-color-secondary, #a8b2bf); font: 11px/1.5 system-ui, sans-serif; cursor: pointer; }
.signal-list__filters button[aria-pressed="true"] { border-color: var(--el-color-primary, #409eff); color: var(--el-color-primary, #409eff); background: var(--el-fill-color-light, #ffffff08); }
.signal-list__filters button:focus-visible { outline: 2px solid var(--el-color-primary, #409eff); }
.signal-list__filters span { margin-left: 3px; font-variant-numeric: tabular-nums; }
.signal-list__filters .signal-list__arrow { margin-left: 0; font-size: 20px; font-weight: 900; line-height: 1; }
.signal-list__cards { display: grid; gap: 8px; }
.signal-list__empty { padding: 15px 5px; text-align: center; color: var(--el-text-color-secondary, #a8b2bf); font-size: 12px; }
</style>
