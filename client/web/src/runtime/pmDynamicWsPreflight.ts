import { watch } from "vue";
import { onPmBookSettingChange } from "./pmBookSettings";
import { useUserStore } from "@/stores/userStore";
import { getPmFokPreflightMode, onPmFokPreflightModeChange } from "@changmen/venue-adapter/polymarket/pmFokPreflightMode";

let cleanup: (() => void) | undefined;
/** [changmen 扩展] 默认关闭的旁路发布门控；经典模式只有轻量配置监听，无候选 watcher/计时器/网络。 */
export function installPmDynamicWsPreflight(): void {
  cleanup?.();
  const user = useUserStore();
  let generation = 0, owner: { stop(): void; reconcile(): void } | undefined;
  const enabled = () => {
    try { return getPmFokPreflightMode() === "optimized" && user.isLoggedIn && user.ready
      && localStorage.getItem("changmen:pm:local-book") === "1"; } catch { return false; }
  };
  const reconcile = () => {
    const ticket = ++generation;
    owner?.stop(); owner = undefined;
    if (!enabled()) return;
    void import("./pmMarketData").then(module => {
      if (generation === ticket && enabled()) owner = module.startPmMarketData(enabled);
    }).catch(() => { /* optional shadow chunk must not block app startup or trading */ });
  };
  const stopMode = onPmFokPreflightModeChange(reconcile);
  const stopSession = watch(() => [user.isLoggedIn, user.ready, user.userId], reconcile, { flush: "sync" });
  const changed = (key: string | null) => {
    if (key === "changmen:pm:local-book" || key === null) reconcile();
    else if (key === "changmen:pm:ws-book-shadow") owner?.reconcile();
  };
  const storage = (event: StorageEvent) => {
    if (event.storageArea === localStorage) changed(event.key);
  };
  const stopSettings = onPmBookSettingChange(changed);
  window.addEventListener("storage", storage);
  reconcile();
  cleanup = () => { ++generation; owner?.stop(); stopMode(); stopSession(); stopSettings(); window.removeEventListener("storage", storage); };
}
export function stopPmDynamicWsPreflight(): void { cleanup?.(); cleanup = undefined; }
