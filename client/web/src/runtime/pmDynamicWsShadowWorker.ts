import { watch } from "vue";
import { useAccountStore } from "@/stores/accountStore";
import { useMatchStore } from "@/stores/matchStore";
import { useOddsStore } from "@/stores/oddsStore";
import { getPmMarketWsSourceMode, resolvePmHttpMode, resolvePmOrderSubmitHttpMode,
  getPolymarketPmSportBlockReason } from "@changmen/venue-adapter/polymarket";
import { officialGateway } from "@changmen/venue-browser/pm-book-diagnostics/bookRuntime";
import { WsBookShadowWorkerClient } from "@changmen/venue-browser/pm-book-diagnostics/shadowWorkerClient";
import type { BookConsumerPort } from "@changmen/pm-market-data-browser/service";

declare global { interface Window { pmWsBookShadowReport?: () => unknown } }
/** 只有实际生效 optimized + 本机显式 shadow 才加载本模块。 */
export function startPmDynamicWsShadowWorker(enabled: () => boolean, service: BookConsumerPort): (() => void) & { reconcile(): void } {
  const accounts = useAccountStore();
  let runtime: WsBookShadowWorkerClient | undefined, stopCandidates: (() => void) | undefined;
  let stopped = false;
  const routes = () => {
    try { return !stopped && enabled() && getPmMarketWsSourceMode() === "official" && resolvePmHttpMode() === "direct"
      && resolvePmOrderSubmitHttpMode() === "direct" && accounts.accounts.some(account => account.provider === "Polymarket"
        && !account.proxyId && officialGateway(account.gateway || "https://clob.polymarket.com")); } catch { return false; }
  };
  const stopRuntime = () => { stopCandidates?.(); stopCandidates = undefined; runtime?.stop(); runtime = undefined; };
  const reconcile = () => {
    if (!routes()) { stopRuntime(); return; }
    if (runtime?.reconcile()) return;
    stopRuntime();
    runtime = new WsBookShadowWorkerClient(routes, service);
    const matches = useMatchStore(), odds = useOddsStore();
    stopCandidates = watch(() => {
      const ids = new Set<string>();
      for (const match of matches.matchs) for (const bet of match.bets) {
        if (getPolymarketPmSportBlockReason(match.pmSport, bet.round)) continue;
        for (const item of bet.items) if (item.type === "Polymarket") {
          for (const id of [item.homeId, item.awayId]) {
            const entry = odds.getPmQuoteEntry(id);
            if (entry && !entry.isLock) ids.add(id);
            if (ids.size >= 16) return [...ids];
          }
        }
      }
      return [...ids];
    }, ids => { if (routes()) runtime?.setAssets(ids); else stopRuntime(); }, { immediate: true });
  };
  // The application owner supplies the route poll; this consumer owns only its watchers.
  const stopAccounts = watch(() => accounts.accounts.map(a => [a.accountId, a.provider, a.gateway, a.proxyId, a.token]),
    () => { stopRuntime(); reconcile(); }, { flush: "sync" });
  const report = () => runtime?.report() ?? { mode: "off", reason: "direct_routes_or_account_unavailable", activeSupported: false };
  window.pmWsBookShadowReport = report;
  reconcile();
  return Object.assign(() => {
    stopped = true; stopAccounts(); stopRuntime();
    if (window.pmWsBookShadowReport === report) delete window.pmWsBookShadowReport;
  }, { reconcile });
}
