import { truncateOddsTo3 } from "@changmen/shared/odds_format";
import { isValidClobPrice, polymarketClobMatchesOdds } from "./pmDetection";

/** [changmen 扩展] Extensions `pmArbPriceBuffer` 运行时镜像（web userStore 同步） */
export interface PmArbPriceBufferPrefs {
  enabled: boolean;
  /** 缺失时沿用百分比；tick 固定增加一档。 */
  mode?: "percent" | "tick";
  /** 卖一倍数；默认 1.01 */
  multiplier: number;
}

const DEFAULT_MULTIPLIER = 1.01;
const modeListeners = new Set<(enabled: boolean) => void>();
export * from "./pmTickBuffer";
export function isPmTickBufferActive(prefs: PmArbPriceBufferPrefs = runtimePrefs): boolean {
  return prefs.enabled === true && prefs.mode === "tick";
}
export function onPmTickBufferModeChange(listener: (enabled: boolean) => void): () => void {
  modeListeners.add(listener);
  return () => { modeListeners.delete(listener); };
}

let runtimePrefs: PmArbPriceBufferPrefs = {
  enabled: false,
  multiplier: DEFAULT_MULTIPLIER,
};

export function setPmArbPriceBufferPrefs(prefs: PmArbPriceBufferPrefs): void {
  const wasTick = isPmTickBufferActive();
  runtimePrefs = {
    enabled: prefs.enabled === true,
    multiplier: normalizePmArbPriceBufferMultiplier(prefs.multiplier),
    ...(prefs.mode === "tick" ? { mode: "tick" as const } : {}),
  };
  const tick = isPmTickBufferActive();
  if (tick !== wasTick) for (const listener of modeListeners) listener(tick);
}

export function getPmArbPriceBufferPrefs(): PmArbPriceBufferPrefs {
  return { ...runtimePrefs };
}

export function resetPmArbPriceBufferPrefsForTests(): void {
  setPmArbPriceBufferPrefs({ enabled: false, multiplier: DEFAULT_MULTIPLIER });
}

export function normalizePmArbPriceBufferMultiplier(raw: unknown): number {
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 1.01 && n <= 1.1)
    return Math.round(n * 1000) / 1000;
  return DEFAULT_MULTIPLIER;
}

/** 是否启用卖一 × multiplier。关（默认）时调用方必须走原路径、不乘倍数。 */
export function isPmArbPriceBufferActive(prefs: PmArbPriceBufferPrefs = runtimePrefs): boolean {
  return prefs.enabled === true && prefs.mode !== "tick" && prefs.multiplier > 1;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function rawAskFromFoEntry(entry: { clobPrice?: number; odds?: number }): number {
  const clob = Number(entry.clobPrice);
  if (isValidClobPrice(clob))
    return clob;
  const odds = Number(entry.odds);
  if (odds > 1) {
    const fromOdds = round4(1 / odds);
    if (isValidClobPrice(fromOdds))
      return fromOdds;
  }
  return 0;
}

/**
 * FOK / 决策用上限。关：原样返回 rawAsk（不 round、不乘）。
 * 开：min(0.9999, round4(rawAsk × multiplier))
 */
export function pmExecCapFromRawAsk(
  rawAsk: number,
  prefs: PmArbPriceBufferPrefs = runtimePrefs,
): number {
  if (!isPmArbPriceBufferActive(prefs) || !isValidClobPrice(rawAsk))
    return rawAsk;
  return Math.min(0.9999, round4(rawAsk * prefs.multiplier));
}

export function pmEffectiveOddsFromRawAsk(
  rawAsk: number,
  prefs: PmArbPriceBufferPrefs = runtimePrefs,
): number {
  if (!isValidClobPrice(rawAsk))
    return 0;
  const cap = pmExecCapFromRawAsk(rawAsk, prefs);
  return truncateOddsTo3(1 / cap);
}

/** fo 条目 → 展示/扫描赔率。关：trunc3(fo.odds)；锁盘 0。 */
export function pmEffectiveOddsFromFoEntry(
  entry: { clobPrice?: number; odds?: number; isLock?: boolean } | null | undefined,
  prefs: PmArbPriceBufferPrefs = runtimePrefs,
): number {
  if (!entry || entry.isLock)
    return 0;
  if (!isPmArbPriceBufferActive(prefs))
    return truncateOddsTo3(Number(entry.odds) || 0);
  const raw = rawAskFromFoEntry(entry);
  if (!isValidClobPrice(raw))
    return truncateOddsTo3(Number(entry.odds) || 0);
  return pmEffectiveOddsFromRawAsk(raw, prefs);
}

/**
 * 预检/下单 FOK 上限辅助（可选）。**bet.ts 不调用**——FOK 仍走 resolvePolymarketDetectionMaxPrice。
 * 关：原样返回。开：resolved 已不优于 detectionOdds 则不再乘；仅 raw 卖一才 × multiplier。
 */
export function resolvePolymarketExecMaxPrice(
  resolvedDetectionMax: number,
  detectionOdds: number,
  prefs: PmArbPriceBufferPrefs = runtimePrefs,
): number {
  if (!isPmArbPriceBufferActive(prefs))
    return resolvedDetectionMax;
  if (!isValidClobPrice(resolvedDetectionMax) || !(detectionOdds > 1))
    return resolvedDetectionMax;
  if (polymarketClobMatchesOdds(resolvedDetectionMax, detectionOdds))
    return resolvedDetectionMax;
  const impliedFromResolved = truncateOddsTo3(1 / resolvedDetectionMax);
  if (!(impliedFromResolved > detectionOdds))
    return resolvedDetectionMax;
  return pmExecCapFromRawAsk(resolvedDetectionMax, prefs);
}
