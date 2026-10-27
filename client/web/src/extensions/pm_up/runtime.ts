import type { ViewMatch } from "@/models/match";
import type { PmUpObservation, PmUpSignal } from "./detector";
import type { PmUpPrefs } from "./settings";
import { onPolymarketMarketQuote } from "@changmen/venue-browser/adapter/polymarket";
import { shallowRef } from "vue";
import { PmUpDetector } from "./detector";
import { indexPmUpMarkets, snapshotPmUpMarket } from "./markets";

export const pmUpSignals = shallowRef<PmUpSignal[]>([]);

export function clearPmUpSignals(): void {
  pmUpSignals.value = [];
}

/** 复用已有行情订阅；事件驱动、无下单、无新增网络请求，不等待主套利循环。 */
export function startPmUpMonitor(config: PmUpPrefs, readMatches: () => readonly ViewMatch[]): () => void {
  if (!config.enabled) return () => {};
  const detector = new PmUpDetector(config);
  let matches = readMatches();
  let index = indexPmUpMarkets(matches);
  let pending: PmUpObservation[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  function drain(): void {
    timer = null;
    if (stopped) return;
    const rows: PmUpSignal[] = [];
    for (const observation of pending.splice(0, 256)) rows.push(...detector.push(observation));
    if (rows.length) pmUpSignals.value = [...rows.reverse(), ...pmUpSignals.value].slice(0, 100);
    if (pending.length) timer = setTimeout(drain, 0);
  }

  const unsubscribe = onPolymarketMarketQuote((quote) => {
    if (stopped) return;
    const latest = readMatches();
    if (latest !== matches) {
      matches = latest;
      index = indexPmUpMarkets(matches);
      const keys = new Set([...index.values()].flatMap(locations => locations.map(location => location.key)));
      detector.retain(keys);
      pending = pending.filter(observation => keys.has(observation.key));
    }
    const receivedAt = Date.now();
    for (const location of index.get(quote.assetId) ?? []) {
      // 在收到事件时冻结场馆报价，延后计算不能把后来的报价写进触发快照。
      const market = snapshotPmUpMarket(location, quote.assetId);
      if (!market) {
        pending = pending.filter(observation => observation.key !== location.key);
        detector.forget(location.key);
        continue;
      }
      if (pending.length >= 4_096) {
        // 队列溢出时重新建基线，不能跨越丢失的行情制造涨价信号。
        pending = [];
        detector.retain(new Set());
      }
      pending.push({ ...market, bestAsk: quote.bestAsk, receivedAt });
    }
    if (pending.length && !timer) timer = setTimeout(drain, 0);
  });

  return () => {
    stopped = true;
    unsubscribe();
    if (timer) clearTimeout(timer);
    pending = [];
  };
}
