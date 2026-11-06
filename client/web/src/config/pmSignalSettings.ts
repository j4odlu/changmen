/** PM 涨降赔信号的纯配置：默认值、类型、规范化和输入边界；由偏好设置与信号模块共同使用。 */

/** [changmen 扩展] PM 涨赔策略仅检测、展示；不参与选号、下单或 POD。 */
export interface PmUpPrefs {
  enabled: boolean;
  minRisePct: number;
  minArbPct: number;
  windowMs: number;
  cooldownMs: number;
}

export function createDefaultPmUpPrefs(): PmUpPrefs {
  return { enabled: false, minRisePct: 0, minArbPct: 1, windowMs: 5_000, cooldownMs: 10_000 };
}

export function normalizePmUpPrefs(raw: unknown): PmUpPrefs {
  const defaults = createDefaultPmUpPrefs();
  const row = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const number = (key: keyof PmUpPrefs, min: number, max: number): number => {
    const value = row[key];
    return typeof value === "number" && Number.isFinite(value)
      ? Math.min(max, Math.max(min, value)) : defaults[key] as number;
  };
  return {
    enabled: row.enabled === true,
    minRisePct: number("minRisePct", 0, 1_000),
    minArbPct: number("minArbPct", 0, 100),
    windowMs: number("windowMs", 500, 60_000),
    cooldownMs: number("cooldownMs", 0, 300_000),
  };
}

export interface PmOddsDropDetectorConfig {
  windowMs: number;
  thresholdPct: number;
  cooldownMs: number;
}

export const DEFAULT_PM_ODDS_DROP_CONFIG: PmOddsDropDetectorConfig = {
  windowMs: 5_000,
  thresholdPct: 5,
  cooldownMs: 10_000,
};

const DEFAULT_REFERENCE_ODDS_MIN = 1.01;
const DEFAULT_REFERENCE_ODDS_MAX = 100;

export type OddsDropReferenceVenue = "Polymarket" | "OB" | "RAY" | "PB";

export interface BrowserPmOddsDropSettings extends PmOddsDropDetectorConfig {
  enabled: boolean;
  minReferenceOdds: number;
  maxReferenceOdds: number;
  referenceVenue: OddsDropReferenceVenue;
}

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
