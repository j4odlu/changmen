import { computed, watch } from "vue";
import { isPmTickBufferActive, onPmTickBufferModeChange, onPmPricePolicyChange, onPmTickBufferChange,
  requestPmTickBufferTick, setPmTickBufferLoader, clearPmTickBufferMetadata,
  retainPmTickBufferRequests, fetchPmTickBufferBook, isValidClobPrice,
  getPolymarketPmSportBlockReason } from "@changmen/venue-adapter/polymarket";
import { useOddsStore } from "@/stores/oddsStore";
import { useMatchStore } from "@/stores/matchStore";

let cleanup: (() => void) | undefined;
/** [changmen 扩展] 独立元数据维护；仅当前比赛预取，不改变采集器或原始行情。 */
export function installPmTickBufferQuotes(): void {
  cleanup?.();
  const odds = useOddsStore();
  const matches = useMatchStore();
  let timer: ReturnType<typeof setInterval> | undefined;
  const activeAssets = computed(() => {
    const ids = new Set<string>();
    for (const match of matches.matchs) for (const bet of match.bets) {
      if (getPolymarketPmSportBlockReason(match.pmSport, bet.round)) continue;
      for (const item of bet.items) {
        if (item.type === "Polymarket") { ids.add(item.homeId); ids.add(item.awayId); }
      }
    }
    return ids;
  });
  const eligible = (id: string) => {
    const entry = odds.getPmQuoteEntry(id);
    return activeAssets.value.has(id) && entry && !entry.isLock && isValidClobPrice(Number(entry.clobPrice));
  };
  const prefetch = () => {
    const wanted = new Set<string>();
    if (odds.pmTickBufferEnabled) for (const id of activeAssets.value) if (eligible(id)) wanted.add(id);
    retainPmTickBufferRequests(wanted);
    for (const id of wanted) requestPmTickBufferTick(id);
  };
  const applyMode = (enabled: boolean) => {
    odds.pmTickBufferEnabled = enabled;
    if (timer) clearInterval(timer);
    setPmTickBufferLoader(enabled ? fetchPmTickBufferBook : undefined);
    timer = enabled ? setInterval(prefetch, 5_000) : undefined;
    // 模式切换仅改变转换规则，已确认的公开 tick 与在途请求不被销毁。
    prefetch();
  };
  // [changmen 扩展] 登出会 $reset fo；报价偏好不变时也须恢复预取镜像，不能等页面刷新。
  const stopEnabled = watch(() => odds.pmTickBufferEnabled, enabled => {
    const active = isPmTickBufferActive();
    if (enabled !== active) applyMode(active);
  }, { flush: "sync" });
  const stopMode = onPmTickBufferModeChange(applyMode);
  const stopPolicy = onPmPricePolicyChange(() => { odds.pmTickBufferVersion++; });
  const stopTick = onPmTickBufferChange(tokenId => {
    if (odds.pmTickBufferEnabled && odds.getPmQuoteEntry(tokenId)) odds.pmTickBufferVersion++;
  });
  const stopMatches = watch(activeAssets, prefetch, { flush: "sync" });
  const stopSave = odds.$onAction(({ name, args, after }) => {
    if (name === "save" && args[0] === "Polymarket") after(() => {
      const id = String(args[1].id);
      if (odds.pmTickBufferEnabled && eligible(id)) requestPmTickBufferTick(id);
    });
  });
  applyMode(isPmTickBufferActive());
  odds.pmTickBufferVersion++;
  cleanup = () => {
    stopEnabled(); stopMode(); stopPolicy(); stopTick(); stopMatches(); stopSave();
    if (timer) clearInterval(timer);
    setPmTickBufferLoader(undefined);
    clearPmTickBufferMetadata();
    odds.pmTickBufferEnabled = false;
  };
}
export function stopPmTickBufferQuotes(): void { cleanup?.(); cleanup = undefined; }
