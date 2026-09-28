import type { PmMarketWsSourceMode } from "@changmen/venue-adapter/polymarket";
import type { PmOddsDropDetectorConfig, PmOddsDropQuote, PmOddsDropSignal } from "./detector";
import type { PmOddsDropVenueSnapshot } from "./venueSnapshot";
import type { BetSide } from "@/models/match";
import {
  getPmMarketWsSourceMode,
  onPolymarketMarketQuote,

} from "@changmen/venue-adapter/polymarket";
import { shallowRef } from "vue";
import {
  DEFAULT_PM_ODDS_DROP_CONFIG,
  PmOddsDropDetector,

} from "./detector";

const SETTINGS_KEY = "changmen:pm-odds-drop:settings:v1";
const MAX_SIGNALS = 100;
const MAX_PENDING_QUOTES = 4_096;
const QUOTES_PER_TASK = 256;
const VENUE_SCAN_INTERVAL_MS = 100;
const DEFAULT_REFERENCE_ODDS_MIN = 1.01;
const DEFAULT_REFERENCE_ODDS_MAX = 100;

export type OddsDropReferenceVenue = "Polymarket" | "OB" | "RAY" | "PB";

export interface OddsDropSelection {
  matchId: number;
  betId: number;
  side: BetSide;
}

export interface ReferenceVenueQuote {
  key: string;
  odds: number;
  selection: OddsDropSelection;
}

export interface BrowserPmOddsDropSettings extends PmOddsDropDetectorConfig {
  enabled: boolean;
  minReferenceOdds: number;
  maxReferenceOdds: number;
  referenceVenue: OddsDropReferenceVenue;
}

export interface BrowserPmOddsDropSignal extends PmOddsDropSignal {
  sourceMode: PmMarketWsSourceMode;
  referenceVenue: OddsDropReferenceVenue;
  selection: OddsDropSelection | null;
  /** 信号生成时的只读快照，后续实时赔率变化不会改写历史 EV。 */
  venueSnapshot: PmOddsDropVenueSnapshot | null;
}

export type PmOddsDropSnapshotResolver = (
  signal: PmOddsDropSignal,
  referenceVenue: OddsDropReferenceVenue,
  selection: OddsDropSelection | null,
) => PmOddsDropVenueSnapshot | null;

export type ReferenceVenueQuoteReader = (
  venue: Exclude<OddsDropReferenceVenue, "Polymarket">,
) => ReferenceVenueQuote[];

function normalizeReferenceVenue(value: unknown): OddsDropReferenceVenue {
  return value === "OB" || value === "RAY" || value === "PB" ? value : "Polymarket";
}

function normalizeReferenceOdds(value: unknown, fallback: number): number {
  const odds = Number(value);
  if (!Number.isFinite(odds) || odds <= 1)
    return fallback;
  return Math.min(Math.max(1.01, odds), 1_000);
}

function normalizeStoredReferenceOddsRange(
  minValue: unknown,
  maxValue: unknown,
): Pick<BrowserPmOddsDropSettings, "minReferenceOdds" | "maxReferenceOdds"> {
  const minReferenceOdds = normalizeReferenceOdds(minValue, DEFAULT_REFERENCE_ODDS_MIN);
  const maxReferenceOdds = normalizeReferenceOdds(maxValue, DEFAULT_REFERENCE_ODDS_MAX);
  return minReferenceOdds <= maxReferenceOdds
    ? { minReferenceOdds, maxReferenceOdds }
    : { minReferenceOdds: maxReferenceOdds, maxReferenceOdds: minReferenceOdds };
}

function loadSettings(): BrowserPmOddsDropSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      return {
        ...DEFAULT_PM_ODDS_DROP_CONFIG,
        enabled: false,
        minReferenceOdds: DEFAULT_REFERENCE_ODDS_MIN,
        maxReferenceOdds: DEFAULT_REFERENCE_ODDS_MAX,
        referenceVenue: "Polymarket",
      };
    }
    const value = JSON.parse(raw) as Partial<BrowserPmOddsDropSettings>;
    const referenceOddsRange = normalizeStoredReferenceOddsRange(
      value.minReferenceOdds,
      value.maxReferenceOdds,
    );
    return {
      windowMs: Math.min(
        Math.max(500, Number(value.windowMs) || DEFAULT_PM_ODDS_DROP_CONFIG.windowMs),
        60_000,
      ),
      thresholdPct: Math.min(
        Math.max(0.1, Number(value.thresholdPct) || DEFAULT_PM_ODDS_DROP_CONFIG.thresholdPct),
        90,
      ),
      cooldownMs: Number(value.cooldownMs) >= 0
        ? Math.min(Number(value.cooldownMs), 5 * 60_000)
        : DEFAULT_PM_ODDS_DROP_CONFIG.cooldownMs,
      enabled: value.enabled === true,
      ...referenceOddsRange,
      referenceVenue: normalizeReferenceVenue(value.referenceVenue),
    };
  }
  catch {
    return {
      ...DEFAULT_PM_ODDS_DROP_CONFIG,
      enabled: false,
      minReferenceOdds: DEFAULT_REFERENCE_ODDS_MIN,
      maxReferenceOdds: DEFAULT_REFERENCE_ODDS_MAX,
      referenceVenue: "Polymarket",
    };
  }
}

export const pmOddsDropSignals = shallowRef<BrowserPmOddsDropSignal[]>([]);
export const pmOddsDropSettings = shallowRef<BrowserPmOddsDropSettings>(loadSettings());

let detector: PmOddsDropDetector | null = null;

export function updatePmOddsDropSettings(patch: Partial<BrowserPmOddsDropSettings>): void {
  const next = {
    ...pmOddsDropSettings.value,
    ...patch,
  };
  // 与 detector 使用相同安全区间，保证浮窗展示的是实际生效值。
  next.windowMs = Math.min(Math.max(500, Number(next.windowMs) || 0), 60_000);
  next.thresholdPct = Math.min(Math.max(0.1, Number(next.thresholdPct) || 0), 90);
  next.cooldownMs = Math.min(Math.max(0, Number(next.cooldownMs) || 0), 5 * 60_000);
  next.enabled = next.enabled === true;
  next.minReferenceOdds = normalizeReferenceOdds(
    next.minReferenceOdds,
    DEFAULT_REFERENCE_ODDS_MIN,
  );
  next.maxReferenceOdds = normalizeReferenceOdds(
    next.maxReferenceOdds,
    DEFAULT_REFERENCE_ODDS_MAX,
  );
  if (next.minReferenceOdds > next.maxReferenceOdds) {
    if (patch.minReferenceOdds !== undefined)
      next.maxReferenceOdds = next.minReferenceOdds;
    else
      next.minReferenceOdds = next.maxReferenceOdds;
  }
  next.referenceVenue = normalizeReferenceVenue(next.referenceVenue);
  pmOddsDropSettings.value = next;
  detector?.updateConfig(next);
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  }
  catch {
    /* ignore */
  }
}

export function clearPmOddsDropSignals(): void {
  pmOddsDropSignals.value = [];
}

export function isReferenceOddsInSignalRange(
  referenceOdds: number,
  settings: Pick<
    BrowserPmOddsDropSettings,
    "minReferenceOdds" | "maxReferenceOdds"
  > = pmOddsDropSettings.value,
): boolean {
  return Number.isFinite(referenceOdds)
    && referenceOdds >= settings.minReferenceOdds
    && referenceOdds <= settings.maxReferenceOdds;
}

/** 浏览器侧独立监测。返回 teardown；不注册新 asset，不影响任何场馆订阅生命周期。 */
export function startPmOddsDropSignalMonitor(
  resolveSnapshot?: PmOddsDropSnapshotResolver,
  readReferenceQuotes?: ReferenceVenueQuoteReader,
): () => void {
  if (!pmOddsDropSettings.value.enabled)
    return () => {};
  const activeDetector = new PmOddsDropDetector(pmOddsDropSettings.value);
  detector = activeDetector;
  let stopped = false;
  let drainTimer: ReturnType<typeof setTimeout> | null = null;
  let activeVenue = pmOddsDropSettings.value.referenceVenue;
  let pendingQuotes: Array<PmOddsDropQuote & {
    referenceVenue: OddsDropReferenceVenue;
    selection: OddsDropSelection | null;
  }> = [];
  let lastPolledOdds = new Map<string, number>();
  const lastQueuedAt = new Map<string, number>();

  const syncReferenceVenue = () => {
    const nextVenue = pmOddsDropSettings.value.referenceVenue;
    if (nextVenue === activeVenue)
      return;
    activeVenue = nextVenue;
    pendingQuotes = [];
    lastPolledOdds.clear();
    lastQueuedAt.clear();
    activeDetector.reset();
  };

  const enqueueQuote = (
    quote: PmOddsDropQuote,
    referenceVenue: OddsDropReferenceVenue,
    selection: OddsDropSelection | null,
  ): boolean => {
    if (pendingQuotes.length >= MAX_PENDING_QUOTES)
      return false;
    pendingQuotes.push({ ...quote, referenceVenue, selection });
    if (!drainTimer)
      drainTimer = setTimeout(drainQuotes, 0);
    return true;
  };

  function drainQuotes() {
    drainTimer = null;
    if (stopped)
      return;
    syncReferenceVenue();
    const batch = pendingQuotes.splice(0, QUOTES_PER_TASK);
    for (const quote of batch) {
      if (quote.referenceVenue !== activeVenue)
        continue;
      const signal = activeDetector.push(quote, isReferenceOddsInSignalRange);
      if (!signal)
        continue;
      const venueSnapshot = safelyResolveSnapshot(
        resolveSnapshot,
        signal,
        quote.referenceVenue,
        quote.selection,
      );
      const row: BrowserPmOddsDropSignal = {
        ...signal,
        sourceMode: getPmMarketWsSourceMode(),
        referenceVenue: quote.referenceVenue,
        selection: quote.selection,
        venueSnapshot,
      };
      pmOddsDropSignals.value = [row, ...pmOddsDropSignals.value].slice(0, MAX_SIGNALS);
    }
    if (pendingQuotes.length)
      drainTimer = setTimeout(drainQuotes, 0);
  }

  const unsubscribe = onPolymarketMarketQuote((quote) => {
    syncReferenceVenue();
    if (activeVenue !== "Polymarket")
      return;
    // 只入本模块队列；检测放到后续 task，不能阻塞 marketQuoteHub 的现有 fo 消费者。
    enqueueQuote({
      assetId: quote.assetId,
      bestAsk: quote.bestAsk,
      receivedAt: Date.now(),
    }, "Polymarket", null);
  });

  const venueScanTimer = setInterval(() => {
    syncReferenceVenue();
    if (activeVenue === "Polymarket" || !readReferenceQuotes)
      return;
    let quotes: ReferenceVenueQuote[];
    try {
      quotes = readReferenceQuotes(activeVenue);
    }
    catch {
      return;
    }
    const nextOdds = new Map<string, number>();
    const receivedAt = Date.now();
    const heartbeatMs = Math.max(100, Math.min(1_000, pmOddsDropSettings.value.windowMs / 2));
    for (const quote of quotes) {
      const odds = Number(quote.odds);
      if (!quote.key || !Number.isFinite(odds) || odds <= 1)
        continue;
      const unchanged = lastPolledOdds.get(quote.key) === odds;
      const heartbeatDue = receivedAt - (lastQueuedAt.get(quote.key) ?? 0) >= heartbeatMs;
      if (unchanged && !heartbeatDue) {
        nextOdds.set(quote.key, odds);
        continue;
      }
      const queued = enqueueQuote({
        assetId: quote.key,
        bestAsk: 1 / odds,
        receivedAt,
      }, activeVenue, quote.selection);
      if (queued) {
        nextOdds.set(quote.key, odds);
        lastQueuedAt.set(quote.key, receivedAt);
      }
    }
    lastPolledOdds = nextOdds;
    const activeKeys = new Set(nextOdds.keys());
    for (const key of lastQueuedAt.keys()) {
      if (!activeKeys.has(key))
        lastQueuedAt.delete(key);
    }
  }, VENUE_SCAN_INTERVAL_MS);

  return () => {
    stopped = true;
    unsubscribe();
    clearInterval(venueScanTimer);
    if (drainTimer)
      clearTimeout(drainTimer);
    drainTimer = null;
    pendingQuotes = [];
    activeDetector.reset();
    if (detector === activeDetector)
      detector = null;
  };
}

function safelyResolveSnapshot(
  resolver: PmOddsDropSnapshotResolver | undefined,
  signal: PmOddsDropSignal,
  referenceVenue: OddsDropReferenceVenue,
  selection: OddsDropSelection | null,
): PmOddsDropVenueSnapshot | null {
  if (!resolver)
    return null;
  try {
    return resolver(signal, referenceVenue, selection);
  }
  catch {
    // 对比快照失败不能中断场馆行情分发或本模块后续信号检测。
    return null;
  }
}
