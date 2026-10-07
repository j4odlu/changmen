import { isPmTickBufferActive, onPmTickBufferModeChange, onPmTickBufferChange,
  requestPmTickBufferTick, setPmTickBufferLoader, clearPmTickBufferMetadata, fetchPmTickBufferBook } from "@changmen/venue-adapter/polymarket";
import { useOddsStore } from "@/stores/oddsStore";

let cleanup: (() => void) | undefined;
/** [changmen 扩展] tick 模式才预取元数据；getter 不请求，百分比不写额外行情。 */
export function installPmTickBufferQuotes(): void {
  cleanup?.();
  const odds = useOddsStore();
  let timer: ReturnType<typeof setInterval> | undefined;
  setPmTickBufferLoader(fetchPmTickBufferBook);
  const prefetch = () => {
    if (!odds.pmTickBufferEnabled) return;
    for (const entry of odds.data.get("Polymarket")?.values() ?? []) {
      if (!entry.isLock && Number(entry.clobPrice) > 0) requestPmTickBufferTick(entry.id);
    }
  };
  const applyMode = (enabled: boolean) => {
    odds.pmTickBufferEnabled = enabled;
    odds.pmTickBufferVersion++;
    if (timer) clearInterval(timer);
    timer = enabled ? setInterval(prefetch, 5_000) : undefined;
    if (!enabled) clearPmTickBufferMetadata();
    prefetch();
  };
  const stopMode = onPmTickBufferModeChange(applyMode);
  const stopTick = onPmTickBufferChange(tokenId => {
    if (odds.pmTickBufferEnabled && odds.getEntry("Polymarket", tokenId)) odds.pmTickBufferVersion++;
  });
  const stopSave = odds.$onAction(({ name, args, after }) => {
    if (name === "save" && args[0] === "Polymarket") after(() => {
      if (odds.pmTickBufferEnabled) requestPmTickBufferTick(String(args[1].id));
    });
  });
  applyMode(isPmTickBufferActive());
  cleanup = () => {
    stopMode(); stopTick(); stopSave();
    if (timer) clearInterval(timer);
    setPmTickBufferLoader(undefined);
    clearPmTickBufferMetadata();
    odds.pmTickBufferEnabled = false;
  };
}
export function stopPmTickBufferQuotes(): void { cleanup?.(); cleanup = undefined; }
