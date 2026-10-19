import type { CollectorFactory } from "@changmen/venue-browser/adapter/contract";
import type { PlatformId } from "@/types/esport";
import { buildCollectorFactories } from "@/runtime/venueAdapters";
import { useCollectStore } from "@/stores/collectStore";

type StopFn = () => void;

const runners = new Map<PlatformId, StopFn>();

const COLLECTOR_FACTORIES: Partial<Record<PlatformId, CollectorFactory>> = buildCollectorFactories();

export async function startCollectors() {
  const collect = useCollectStore();
  if (!collect.ready)
    await collect.init();

  for (const [platform, factory] of Object.entries(COLLECTOR_FACTORIES) as [PlatformId, CollectorFactory][]) {
    syncCollector(platform, true, factory);
  }
}

export function stopCollectors() {
  for (const stop of runners.values()) stop();
  runners.clear();
}

export function syncCollectorsFromConfig() {
  const collect = useCollectStore();
  if (!collect.ready)
    return;
  for (const [platform, factory] of Object.entries(COLLECTOR_FACTORIES) as [PlatformId, CollectorFactory][]) {
    if (!runners.has(platform)) {
      syncCollector(platform, true, factory);
    }
  }
}

/** 已启动的采集器按当前门控重拉。未 startCollectors 时 noop（避免登录前误启）。 */
export function restartCollector(platform: PlatformId) {
  if (!runners.has(platform))
    return;
  const factory = COLLECTOR_FACTORIES[platform];
  if (!factory)
    return;
  syncCollector(platform, true, factory);
}

/** 用户中心「赛事采集」开关仅控制 collectStore.saveMatch/saveBets，不用于启停采集器。 */

function syncCollector(platform: PlatformId, enabled: boolean, factory: CollectorFactory) {
  const prev = runners.get(platform);
  if (prev) {
    prev();
    runners.delete(platform);
  }
  if (enabled)
    runners.set(platform, factory());
}
