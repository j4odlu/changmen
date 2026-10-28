import type { BrowserPmOddsDropSignal } from "./downSettings";
import type { PmUpSignal } from "./upDetector";
import { shallowRef } from "vue";

/** 两种策略共用的记录容器；唯一监测入口位于 runtime.ts。 */
export const pmUpSignals = shallowRef<PmUpSignal[]>([]);
export const pmOddsDropSignals = shallowRef<BrowserPmOddsDropSignal[]>([]);

export function clearPmUpSignals(): void {
  pmUpSignals.value = [];
}

export function clearPmOddsDropSignals(): void {
  pmOddsDropSignals.value = [];
}
