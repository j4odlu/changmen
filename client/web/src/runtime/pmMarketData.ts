import { watch } from "vue";
import { useAccountStore } from "@/stores/accountStore";
import { getPmMarketWsSourceMode, resolvePmHttpMode, resolvePmOrderSubmitHttpMode } from "@changmen/venue-adapter/polymarket";
import { createPmOrderBookService, type PmOrderBookService, type BookLease } from "@changmen/venue-adapter/polymarket/orderBook";
import { startPmDynamicWsShadowWorker } from "./pmDynamicWsShadowWorker";

let active: PmOrderBookService | undefined;
/** Reserved depth consumer entry. It cannot start an unauthorized session. */
export function acquirePmDepthView(): BookLease | undefined { return active?.report().worker ? active.acquire() : undefined; }
declare global { interface Window { pmLocalBookReport?: () => unknown } }
export function startPmMarketData(enabled: () => boolean): { stop(): void; reconcile(): void } {
  const accounts = useAccountStore();
  let service: PmOrderBookService | undefined, stopConsumer: ((() => void) & { reconcile?: () => void }) | undefined, stopped = false;
  const allowed = () => {
    try { return !stopped && enabled() && getPmMarketWsSourceMode() === "official" && resolvePmHttpMode() === "direct"
      && resolvePmOrderSubmitHttpMode() === "direct" && accounts.accounts.some(a => a.provider === "Polymarket" && !a.proxyId
        && /^https:\/\/clob\.polymarket\.com\/?$/.test(a.gateway || "https://clob.polymarket.com")); } catch { return false; }
  };
  const shadow = () => { try { return allowed() && localStorage.getItem("changmen:pm:ws-book-shadow") === "1"; } catch { return false; } };
  const release = () => {
    stopConsumer?.(); stopConsumer = undefined;
    if (active === service) active = undefined;
    service?.stop(); service = undefined;
  };
  const reconcile = () => {
    if (!allowed()) { release(); return; }
    if (!service) { service = createPmOrderBookService(allowed); active = service; }
    // A failed service remains failed until a new authorized session; no retry loop.
    if (shadow() && !stopConsumer && service.report().worker) stopConsumer = startPmDynamicWsShadowWorker(shadow, service);
    if (shadow()) stopConsumer?.reconcile?.();
    if (!shadow()) { stopConsumer?.(); stopConsumer = undefined; }
  };
  const stopAccounts = watch(() => accounts.accounts.map(a => [a.accountId, a.provider, a.gateway, a.proxyId]), reconcile, { flush: "sync" });
  const timer = setInterval(reconcile, 1_000);
  const report = () => service?.report() ?? { mode: "off", activeSupported: false };
  window.pmLocalBookReport = report;
  reconcile();
  return { reconcile, stop: () => {
    stopped = true; clearInterval(timer); stopAccounts(); release();
    if (window.pmLocalBookReport === report) delete window.pmLocalBookReport;
  } };
}
