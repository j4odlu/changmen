/** [changmen 扩展] LOS/9999 纯前端仓位入口；独立观察已有订单，不驱动套利或请求。 */
import { isLowOddsSingleLink, isSingleLegRateLink } from "@changmen/client-core/shared/format";
import { hasOpenPolymarketPosition, resolvePmRemainingShares } from "@changmen/venue-browser/polymarket/orders/positions/pmLogicalPosition";
import { computed, onScopeDispose, readonly, shallowRef, watch } from "vue";
import type { OrderRow } from "@/types/order";
import { useAccountStore } from "@/stores/accountStore";
import { useOrderStore } from "@/stores/orderStore";
import { useUserStore } from "@/stores/userStore";

const positions = shallowRef<readonly OrderRow[]>([]);
export const singleLegPositions = readonly(positions);
export const pendingSingleLegPositions = computed(() => singleLegPositions.value.filter((row) => {
  const status = String(row.Status ?? "None").toLowerCase();
  if (status === "reject" || status === "return")
    return false;
  if (row.Type === "Polymarket") {
    if (row.PmSellState === "closed" || row.PmSellState === "settled")
      return false;
    if (Number(row.PmAttributedSellShares) > 0 && resolvePmRemainingShares(row) <= 0)
      return false;
    return status === "pending" || hasOpenPolymarketPosition(row);
  }
  if (row.Type === "PredictFun" && (row.PfSellState === "closed" || row.PfSellState === "settled"))
    return false;
  return status === "none" || status === "pending";
}));
export type SingleLegStrategy = (positions: typeof singleLegPositions.value) => void | Promise<void>;

/** [changmen 扩展] 独立策略接入点，目前只观察，不发起交易。 */
export function runSingleLegStrategy(_positions: typeof singleLegPositions.value): void {}

/** App 登录生命周期入口。后续策略通过 onPositions 接入，目前默认只收集仓位。 */
export function setupSingleLegStrategy(onPositions: SingleLegStrategy = runSingleLegStrategy): void {
  const user = useUserStore();
  const accounts = useAccountStore();
  const orders = useOrderStore();
  const owner = computed(() => user.isLoggedIn && !accounts.adminWorkspacePreview ? String(user.userId || "") : "");
  let previousOwner: string | undefined;
  let blockedCache: typeof orders.orders | undefined;
  const clear = () => { positions.value = []; };
  const warn = (error: unknown) => { console.warn("[singleLegStrategy] 观察仓位失败", error); };

  // 身份变更立即清空；订单监听延后到当前同步加载结束，接收同一 tick 交付的新缓存。
  watch(owner, (currentOwner) => {
    const initial = previousOwner === undefined;
    previousOwner = currentOwner;
    clear();
    blockedCache = initial && currentOwner ? undefined : orders.orders;
  }, { immediate: true, flush: "sync" });

  watch(() => [owner.value, orders.orders] as const,
    ([currentOwner, cache]) => {
      if (!currentOwner || cache === blockedCache)
        return;
      try {
        const rows = [...cache.values()].flat().filter(row => row.OrderID && row.PlayerID && row.Type && !row.DisplayOnly
          && (isLowOddsSingleLink(row.Link) || isSingleLegRateLink(row.Link))
          && row.PmSide !== "sell" && row.PfSide !== "sell");
        // 订单为 JSON 数据；序列化同时解除嵌套 Vue Proxy，避免 structuredClone 抛 DataCloneError。
        positions.value = JSON.parse(JSON.stringify(rows)) as OrderRow[];
      }
      catch (error) {
        clear();
        warn(error);
        return;
      }
      try {
        void Promise.resolve(onPositions(singleLegPositions.value)).catch(warn);
      }
      catch (error) {
        warn(error);
      }
    }, { deep: true, immediate: true, flush: "post" });

  onScopeDispose(clear);
}
