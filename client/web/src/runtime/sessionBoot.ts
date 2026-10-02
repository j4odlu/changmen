import "@/stores/account/polymarketVenueSync";
import { useCollectStore } from "@/stores/collectStore";
import { useLoseOrderStore } from "@/stores/loseOrderStore";
import { useUserStore } from "@/stores/userStore";

let sessionBooted = false;
let generation = 0;
let pending: { generation: number; task: Promise<void> } | null = null;

/** Serialize initialization; failures remain retryable and logout cancels stale work. */
export function bootSessionRuntime(): Promise<void> {
  if (sessionBooted)
    return Promise.resolve();
  const current = generation;
  if (pending?.generation === current)
    return pending.task;
  const previous = pending?.task;
  const task = (async () => {
    await previous?.catch(() => {});
    if (generation !== current)
      return;
    useLoseOrderStore().init();
    const collectStore = useCollectStore();
    const userStore = useUserStore();
    await Promise.all([collectStore.init(), userStore.loadConfig()]);
    if (generation !== current)
      return;
    await userStore.syncPbCollectModeFromLocal();
    const { startCollectors, stopCollectors } = await import("@/runtime/collectors");
    if (generation !== current)
      return;
    try {
      await startCollectors();
      if (generation !== current) {
        stopCollectors();
        return;
      }
      const { primeStakeTabId } = await import("@changmen/venue-adapter/stake");
      if (generation !== current) {
        stopCollectors();
        return;
      }
      primeStakeTabId();
      sessionBooted = true;
    }
    catch (err) {
      stopCollectors();
      throw err;
    }
  })();
  const entry = { generation: current, task };
  pending = entry;
  void task.finally(() => { if (pending === entry) pending = null; }).catch(() => {});
  return task;
}

export function stopSessionRuntime(): void {
  generation += 1;
  if (!sessionBooted)
    return;
  sessionBooted = false;
  void import("@/runtime/collectors").then(({ stopCollectors }) => stopCollectors());
}
