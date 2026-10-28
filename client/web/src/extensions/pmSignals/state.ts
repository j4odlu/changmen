import { computed, ref } from "vue";
import { clearPmOddsDropSignals, clearPmUpSignals, pmOddsDropSignals, pmUpSignals } from "./records";
import { filterSignals, presentDropSignal, presentUpSignal } from "./presentation";

// 单例浮窗驱动时钟，盘口卡片共用，避免每个地图单独创建定时器。
export const signalNow = ref(Date.now());
export const signalFocusRequest = ref<{ id: string } | null>(null);
export function revealSignal(id: string): void {
  signalFocusRequest.value = { id };
}
export const allSignals = computed(() => filterSignals([
  ...pmOddsDropSignals.value.map(signal => presentDropSignal(signal)),
  ...pmUpSignals.value.map(presentUpSignal),
], "all"));

export function clearAllSignals(): void {
  clearPmOddsDropSignals();
  clearPmUpSignals();
  signalFocusRequest.value = null;
}
