import type { PmMarketWsSourceMode } from "@changmen/venue-browser/adapter/polymarket";
import type { PmOddsDropDetectorConfig, PmOddsDropSignal } from "./downDetector";
import type { PmOddsDropVenueSnapshot } from "./downVenueSnapshot";
import type { BetSide } from "@/models/match";
import { DEFAULT_PM_ODDS_DROP_CONFIG } from "./downDetector";

const SETTINGS_KEY = "changmen:pm-odds-drop:settings:v1";
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
  /** 行情接收时捕获的只读快照，异步判定与后续变价不会改写历史 EV。 */
  venueSnapshot: PmOddsDropVenueSnapshot | null;
}

export type PmOddsDropSnapshotQuote = Pick<PmOddsDropSignal, "assetId" | "currentOdds">;

/** 在报价入队时捕获；不依赖随后异步检测才生成的涨跌幅、基线等字段。 */
export type PmOddsDropSnapshotResolver = (
  quote: PmOddsDropSnapshotQuote,
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

export function createDefaultPmOddsDropSettings(): BrowserPmOddsDropSettings {
  return {
    ...DEFAULT_PM_ODDS_DROP_CONFIG,
    enabled: false,
    minReferenceOdds: DEFAULT_REFERENCE_ODDS_MIN,
    maxReferenceOdds: DEFAULT_REFERENCE_ODDS_MAX,
    referenceVenue: "Polymarket",
  };
}

export function normalizePmOddsDropSettings(raw: unknown): BrowserPmOddsDropSettings {
  const defaults = createDefaultPmOddsDropSettings();
  const value = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Partial<BrowserPmOddsDropSettings> : {};
  const number = (value: unknown, fallback: number, min: number, max: number) => {
    if (value == null || value === "") return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
  };
  return {
    enabled: value.enabled === true,
    referenceVenue: normalizeReferenceVenue(value.referenceVenue),
    ...normalizeStoredReferenceOddsRange(value.minReferenceOdds, value.maxReferenceOdds),
    windowMs: number(value.windowMs, defaults.windowMs, 500, 60_000),
    thresholdPct: number(value.thresholdPct, defaults.thresholdPct, 0.1, 90),
    cooldownMs: number(value.cooldownMs, defaults.cooldownMs, 0, 300_000),
  };
}

/** 仅迁移旧本机配置；已保存的用户配置始终优先，不再写入旧 key。 */
export function readLegacyPmOddsDropSettings(): BrowserPmOddsDropSettings | undefined {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return undefined;
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? normalizePmOddsDropSettings(value) : undefined;
  }
  catch { return undefined; }
}

export function patchPmOddsDropSettings(
  current: BrowserPmOddsDropSettings,
  patch: Partial<BrowserPmOddsDropSettings>,
): BrowserPmOddsDropSettings {
  const next = { ...current, ...patch };
  // 与 detector 使用相同安全区间，保证浮窗展示的是实际生效值。
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
  return normalizePmOddsDropSettings(next);
}

export function isReferenceOddsInSignalRange(
  referenceOdds: number,
  settings: Pick<
    BrowserPmOddsDropSettings,
    "minReferenceOdds" | "maxReferenceOdds"
  > = createDefaultPmOddsDropSettings(),
): boolean {
  return Number.isFinite(referenceOdds)
    && referenceOdds >= settings.minReferenceOdds
    && referenceOdds <= settings.maxReferenceOdds;
}
