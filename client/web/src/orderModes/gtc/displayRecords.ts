import type { GtcExecution } from "@changmen/shared/pm_gtc";
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from "vue";
import { getAuthSessionVersion, isAuthSessionCurrent } from "@/api/client";
import { useUserStore } from "@/stores/userStore";
import { listGtc } from "./api";
import { gtcProgress } from "./gtcProgressState";

/** [changmen 扩展] 零成交列表只读加载；不启动执行器，不写入财务 store 或执行状态。 */
export function useGtcDisplayRecords(enabled: () => boolean = () => true) {
  const user = useUserStore();
  const loaded = shallowRef<GtcExecution[]>([]);
  const error = ref("");
  let generation = 0;
  let pendingGeneration: number | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let stopWatch: (() => void) | undefined;

  const records = computed(() => {
    if (!enabled() || !user.isLoggedIn || !user.userId)
      return [];
    const owner = String(user.userId);
    const byId = new Map(loaded.value.filter(row => row.owner === owner).map(row => [row.id, row]));
    // 相同原单优先使用执行器更近的事实，显示读取不能覆盖其 revision 或状态。
    if (gtcProgress.owner === owner) {
      for (const row of gtcProgress.records) {
        if (row.owner === owner && (!byId.has(row.id) || byId.get(row.id)!.revision <= row.revision))
          byId.set(row.id, row);
      }
    }
    return [...byId.values()];
  });

  function clear() {
    generation += 1;
    if (timer)
      clearInterval(timer);
    timer = undefined;
    loaded.value = [];
    error.value = "";
  }

  async function refresh(stamp: number, owner: string) {
    if (pendingGeneration === stamp)
      return;
    const session = getAuthSessionVersion();
    const current = () => generation === stamp && user.isLoggedIn && String(user.userId) === owner && isAuthSessionCurrent(session);
    pendingGeneration = stamp;
    try {
      const rows = await listGtc();
      if (!current())
        return;
      loaded.value = rows.filter(row => row.owner === owner && row.submit === "accepted" && Number(row.matched) === 0);
      error.value = "";
    }
    catch {
      if (current())
        error.value = "零成交 GTC 订单读取失败，已加载订单仍保留，请稍后重试";
    }
    finally {
      if (pendingGeneration === stamp)
        pendingGeneration = undefined;
    }
  }

  onMounted(() => {
    stopWatch = watch(() => [user.isLoggedIn, user.userId, enabled()] as const, ([loggedIn, id, visible]) => {
      clear();
      if (!loggedIn || !id || !visible)
        return;
      const stamp = generation;
      const owner = String(id);
      void refresh(stamp, owner);
      timer = setInterval(() => { void refresh(stamp, owner); }, 15000);
    }, { immediate: true });
  });
  onUnmounted(() => { stopWatch?.(); clear(); });
  return { records, error };
}
