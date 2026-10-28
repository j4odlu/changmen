import type { ViewMatch } from "@/models/match";
import type { PmUpMarket, PmUpObservation, PmUpSignal } from "./upDetector";
import type { PmUpPrefs } from "./upSettings";
import type { PmOddsDropQuote } from "./downDetector";
import type { BrowserPmOddsDropSettings, OddsDropReferenceVenue, OddsDropSelection, PmOddsDropSnapshotResolver, ReferenceVenueQuote, ReferenceVenueQuoteReader } from "./downSettings";
import { getPmMarketWsSourceMode, onPolymarketMarketQuote } from "@changmen/venue-browser/adapter/polymarket";
import { computed, shallowRef, watch } from "vue";
import { PmUpDetector } from "./upDetector";
import { indexPmUpMarkets, snapshotPmUpMarket } from "./upMarkets";
import { clearPmUpSignals, pmOddsDropSignals, pmUpSignals } from "./records";
import { normalizePmUpPrefs } from "./upSettings";
import { PmOddsDropDetector } from "./downDetector";
import { isReferenceOddsInSignalRange } from "./downSettings";
import { capturePmOddsDropVenueSnapshot, readReferenceVenueQuotes, resolvePmOddsDropVenueSnapshot, type PmOddsDropVenueSnapshot } from "./downVenueSnapshot";

export interface PmSignalMonitorSettings {
  down: BrowserPmOddsDropSettings;
  up: PmUpPrefs;
}

interface PendingQuote {
  quote: PmOddsDropQuote;
  venue: OddsDropReferenceVenue;
  selection: OddsDropSelection | null;
  downGeneration: number;
  upGeneration: number;
  up: PmUpObservation[];
  downSnapshot: PmOddsDropVenueSnapshot | null;
  sourceMode: ReturnType<typeof getPmMarketWsSourceMode>;
}

const MAX_PENDING_QUOTES = 4096;
const QUOTES_PER_TASK = 256;
const MAX_SIGNALS = 100;

/**
 * [changmen 扩展] 唯一监测入口：一份 PM 回调、一个有界队列、一个异步 drain。
 * 涨跌纯判定策略保留各自窗口、阈值与冷却；非 PM 降赔基准按需只读轮询。
 */
export function startPmSignalMonitor(
  readSettings: () => PmSignalMonitorSettings,
  readMatches: () => readonly ViewMatch[],
  ports: { resolveSnapshot?: PmOddsDropSnapshotResolver; readReferenceQuotes?: ReferenceVenueQuoteReader } = {},
): () => void {
  let settings: PmSignalMonitorSettings | undefined;
  let down: PmOddsDropDetector | null = null;
  let up: PmUpDetector | null = null;
  let downGeneration = 0;
  let upGeneration = 0;
  const indexedMatches = shallowRef<readonly ViewMatch[]>([]);
  const marketIndex = computed(() => indexPmUpMarkets(indexedMatches.value));
  let index = marketIndex.value;
  let pendingQuotes: PendingQuote[] = [];
  let drainTimer: ReturnType<typeof setTimeout> | null = null;
  let scanTimer: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: (() => void) | null = null;
  let stopped = false;
  let lastPolledOdds = new Map<string, number>();
  const lastQueuedAt = new Map<string, number>();

  function syncMatches(force = false): void {
    if (!up && !(down && settings?.down.referenceVenue === "Polymarket")) return;
    indexedMatches.value = readMatches();
    const latest = marketIndex.value;
    if (!force && latest === index) return;
    index = latest;
    const keys = new Set([...index.values()].flatMap(locations => locations.map(location => location.key)));
    up?.retain(keys);
    for (const pending of pendingQuotes) pending.up = pending.up.filter(observation => keys.has(observation.key));
  }

  function enqueueQuote(quote: PmOddsDropQuote, venue: OddsDropReferenceVenue, selection: OddsDropSelection | null, observations: PmUpObservation[] = []): void {
    if (pendingQuotes.length >= MAX_PENDING_QUOTES) {
      // 丢过行情后两种策略均重建基线，不能跨越丢失样本制造信号。
      pendingQuotes = [];
      down?.reset();
      up?.retain(new Set());
    }
    const downSnapshot = down && settings?.down.referenceVenue === venue ? snapshot(quote, venue, selection) : null;
    pendingQuotes.push({ quote, venue, selection, up: observations, downGeneration, upGeneration,
      downSnapshot, sourceMode: getPmMarketWsSourceMode() });
    if (!drainTimer) drainTimer = setTimeout(drainQuotes, 0);
  }

  function snapshot(quote: PmOddsDropQuote, venue: OddsDropReferenceVenue, selection: OddsDropSelection | null) {
    if (!Number.isFinite(quote.bestAsk) || quote.bestAsk <= 0 || quote.bestAsk >= 1) return null;
    const currentOdds = 1 / quote.bestAsk;
    try {
      if (ports.resolveSnapshot) return ports.resolveSnapshot({ assetId: quote.assetId, currentOdds }, venue, selection);
      if (venue === "Polymarket") {
        const location = index.get(quote.assetId)?.[0];
        return location ? capturePmOddsDropVenueSnapshot(location.match, location.bet, location.side, currentOdds, venue) : null;
      }
      return resolvePmOddsDropVenueSnapshot(readMatches(), { assetId: quote.assetId, currentOdds }, venue, selection);
    } catch {
      return null;
    }
  }

  function drainQuotes(): void {
    drainTimer = null;
    if (stopped || !settings) return;
    const upRows: PmUpSignal[] = [];
    for (const entry of pendingQuotes.splice(0, QUOTES_PER_TASK)) {
      if (down && entry.downGeneration === downGeneration && entry.venue === settings.down.referenceVenue) {
        const signal = down.push(entry.quote, odds => isReferenceOddsInSignalRange(odds, settings!.down));
        if (signal) {
          pmOddsDropSignals.value = [{
            ...signal, referenceVenue: entry.venue, selection: entry.selection,
            sourceMode: entry.sourceMode, venueSnapshot: entry.downSnapshot,
          }, ...pmOddsDropSignals.value].slice(0, MAX_SIGNALS);
        }
      }
      if (up && entry.upGeneration === upGeneration) {
        for (const observation of entry.up) upRows.push(...up.push(observation));
      }
    }
    if (upRows.length) pmUpSignals.value = [...upRows.reverse(), ...pmUpSignals.value].slice(0, MAX_SIGNALS);
    if (pendingQuotes.length) drainTimer = setTimeout(drainQuotes, 0);
  }

  function receivePmQuote(quote: { assetId: string; bestAsk: number }): void {
    if (stopped || !settings) return;
    syncMatches();
    const receivedAt = Date.now();
    const observations: PmUpObservation[] = [];
    if (up) {
      for (const location of index.get(quote.assetId) ?? []) {
        // 收到 PM 行情时冻结对侧报价，异步计算不能使用后来的价格。
        let market: PmUpMarket | null;
        try { market = snapshotPmUpMarket(location, quote.assetId); }
        catch { market = null; }
        if (!market) {
          up.forget(location.key);
          for (const pending of pendingQuotes) pending.up = pending.up.filter(row => row.key !== location.key);
          continue;
        }
        observations.push({ ...market, bestAsk: quote.bestAsk, receivedAt });
      }
    }
    if ((down && settings.down.referenceVenue === "Polymarket") || observations.length)
      enqueueQuote({ ...quote, receivedAt }, "Polymarket", null, observations);
  }

  function scanReferenceVenue(): void {
    if (stopped || !down || !settings || settings.down.referenceVenue === "Polymarket") return;
    const venue = settings.down.referenceVenue;
    let quotes: ReferenceVenueQuote[];
    try {
      quotes = ports.readReferenceQuotes ? ports.readReferenceQuotes(venue) : readReferenceVenueQuotes(readMatches(), venue);
    } catch {
      return;
    }
    const nextOdds = new Map<string, number>();
    const receivedAt = Date.now();
    const heartbeatMs = Math.max(100, Math.min(1000, settings.down.windowMs / 2));
    for (const quote of quotes) {
      const odds = Number(quote.odds);
      if (!quote.key || !Number.isFinite(odds) || odds <= 1) continue;
      const unchanged = lastPolledOdds.get(quote.key) === odds;
      const heartbeatDue = receivedAt - (lastQueuedAt.get(quote.key) ?? 0) >= heartbeatMs;
      if (!unchanged || heartbeatDue) {
        enqueueQuote({ assetId: quote.key, bestAsk: 1 / odds, receivedAt }, venue, quote.selection);
        lastQueuedAt.set(quote.key, receivedAt);
      }
      nextOdds.set(quote.key, odds);
    }
    lastPolledOdds = nextOdds;
    for (const key of lastQueuedAt.keys()) if (!nextOdds.has(key)) lastQueuedAt.delete(key);
  }

  function syncResources(): void {
    const needsPm = Boolean(up || (down && settings?.down.referenceVenue === "Polymarket"));
    if (needsPm && !unsubscribe) unsubscribe = onPolymarketMarketQuote(receivePmQuote);
    else if (!needsPm && unsubscribe) { unsubscribe(); unsubscribe = null; }
    const needsScan = Boolean(down && settings?.down.referenceVenue !== "Polymarket");
    if (needsScan && !scanTimer) scanTimer = setInterval(scanReferenceVenue, 100);
    else if (!needsScan && scanTimer) { clearInterval(scanTimer); scanTimer = null; }
    if (!down && !up) {
      pendingQuotes = [];
      if (drainTimer) clearTimeout(drainTimer);
      drainTimer = null;
    }
  }

  const stopSettingsWatch = watch(readSettings, (config) => {
    const previous = settings;
    settings = { down: { ...config.down }, up: normalizePmUpPrefs(config.up) };
    if (JSON.stringify(previous?.up) !== JSON.stringify(settings.up)) {
      upGeneration++;
      clearPmUpSignals();
      up = settings.up.enabled ? new PmUpDetector(settings.up) : null;
      syncMatches(true);
    }
    if (!previous || previous.down.enabled !== settings.down.enabled || previous.down.referenceVenue !== settings.down.referenceVenue) {
      downGeneration++;
      down = settings.down.enabled ? new PmOddsDropDetector(settings.down) : null;
      lastPolledOdds.clear();
      lastQueuedAt.clear();
    } else {
      down?.updateConfig(settings.down);
    }
    syncResources();
  }, { immediate: true, deep: true, flush: "sync" });

  return () => {
    if (stopped) return;
    stopped = true;
    stopSettingsWatch();
    unsubscribe?.();
    unsubscribe = null;
    if (scanTimer) clearInterval(scanTimer);
    if (drainTimer) clearTimeout(drainTimer);
    scanTimer = drainTimer = null;
    pendingQuotes = [];
    down?.reset();
    up?.retain(new Set());
  };
}
