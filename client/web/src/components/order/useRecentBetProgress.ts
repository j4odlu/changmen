import type { ActiveBetRun } from "@/types/activeBetRun";
import type { Ref } from "vue";
import { computed, ref, watch } from "vue";

function runKey(run: ActiveBetRun): string {
  return `${run.betId}:${run.linkId ?? ""}:${run.startedAt}`;
}

/** [changmen 扩展] 浮窗会话内的只读快照，不写回业务 store，也不参与下单决策。 */
export function useRecentBetProgress(source: Ref<ActiveBetRun[]>, owner: Ref<string>) {
  const snapshots = ref<ActiveBetRun[]>([]);
  const selectedKey = ref<string | null>(null);
  const followLatest = ref(true);
  const unseenLatest = ref(false);
  const liveKeys = computed(() => new Set(source.value.map(runKey)));

  watch(owner, () => {
    snapshots.value = [];
    selectedKey.value = null;
    followLatest.value = true;
    unseenLatest.value = false;
  }, { flush: "sync" });

  watch(source, (runs) => {
    if (!owner.value)
      return;
    const previousNewest = snapshots.value[0];
    const merged = new Map(snapshots.value.map(run => [runKey(run), run]));
    for (const run of runs) {
      // 手工复制嵌套事件，避免留存快照与业务对象共享可变引用。
      merged.set(runKey(run), {
        ...run,
        events: run.events.map(event => ({ ...event })),
        legs: run.legs.map(leg => ({ ...leg, events: leg.events.map(event => ({ ...event })) })),
      });
    }
    const sorted = [...merged.values()].sort((a, b) => b.startedAt - a.startedAt || b.betId - a.betId);
    snapshots.value = sorted.filter((run, index) => index < 3 || (!run.terminalAt && liveKeys.value.has(runKey(run))));
    const newest = snapshots.value[0];
    if (newest && previousNewest && runKey(newest) !== runKey(previousNewest))
      unseenLatest.value = !followLatest.value;
    if (followLatest.value || !snapshots.value.some(run => runKey(run) === selectedKey.value)) {
      selectedKey.value = newest ? runKey(newest) : null;
      followLatest.value = true;
      unseenLatest.value = false;
    }
  }, { immediate: true, deep: true, flush: "sync" });

  const activeIndex = computed(() => Math.max(0, snapshots.value.findIndex(run => runKey(run) === selectedKey.value)));
  const activeRun = computed(() => snapshots.value[activeIndex.value] ?? null);
  function selectRun(run: ActiveBetRun) {
    selectedKey.value = runKey(run);
    followLatest.value = false;
  }
  function showLatest() {
    selectedKey.value = snapshots.value[0] ? runKey(snapshots.value[0]) : null;
    followLatest.value = true;
    unseenLatest.value = false;
  }
  function isTracking(run: ActiveBetRun) {
    return liveKeys.value.has(runKey(run));
  }
  return { displayRuns: snapshots, activeIndex, activeRun, unseenLatest, selectRun, showLatest, isTracking };
}
