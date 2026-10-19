import { truncateOddsTo3 } from "@changmen/shared/odds_format";
import { isValidPredictClobPrice, predictFunClobMatchesOdds } from "./pfDetection";

/** [changmen 扩展] Extensions `pfArbPriceBuffer` 运行时镜像（web userStore 同步） */
export interface PfArbPriceBufferPrefs {
  enabled: boolean;
  /** 卖一倍数；默认 1.01 */
  multiplier: number;
}

const DEFAULT_MULTIPLIER = 1.01;

let runtimePrefs: PfArbPriceBufferPrefs = {
  enabled: false,
  multiplier: DEFAULT_MULTIPLIER,
};

export function setPfArbPriceBufferPrefs(prefs: PfArbPriceBufferPrefs): void {
  runtimePrefs = {
    enabled: prefs.enabled === true,
    multiplier: normalizePfArbPriceBufferMultiplier(prefs.multiplier),
  };
}

export function getPfArbPriceBufferPrefs(): PfArbPriceBufferPrefs {
  return { ...runtimePrefs };
}

export function resetPfArbPriceBufferPrefsForTests(): void {
  runtimePrefs = { enabled: false, multiplier: DEFAULT_MULTIPLIER };
}

export function normalizePfArbPriceBufferMultiplier(raw: unknown): number {
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 1.01 && n <= 1.1)
    return Math.round(n * 1000) / 1000;
  return DEFAULT_MULTIPLIER;
}

/** 是否启用卖一 × multiplier。关（默认）时调用方必须走原路径、不乘倍数。 */
export function isPfArbPriceBufferActive(prefs: PfArbPriceBufferPrefs = runtimePrefs): boolean {
  return prefs.enabled === true && prefs.multiplier > 1;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function rawAskFromFoEntry(entry: { clobPrice?: number; odds?: number }): number {
  const clob = Number(entry.clobPrice);
  if (isValidPredictClobPrice(clob))
    return clob;
  const odds = Number(entry.odds);
  if (odds > 1) {
    const fromOdds = round4(1 / odds);
    if (isValidPredictClobPrice(fromOdds))
      return fromOdds;
  }
  return 0;
}

/**
 * 预检限价上限。关：原样返回 rawAsk（不 round、不乘）。
 * 开：min(0.9999, round4(rawAsk × multiplier))
 */
export function pfExecCapFromRawAsk(
  rawAsk: number,
  prefs: PfArbPriceBufferPrefs = runtimePrefs,
): number {
  if (!isPfArbPriceBufferActive(prefs) || !isValidPredictClobPrice(rawAsk))
    return rawAsk;
  return Math.min(0.9999, round4(rawAsk * prefs.multiplier));
}

export function pfEffectiveOddsFromRawAsk(
  rawAsk: number,
  prefs: PfArbPriceBufferPrefs = runtimePrefs,
): number {
  if (!isValidPredictClobPrice(rawAsk))
    return 0;
  const cap = pfExecCapFromRawAsk(rawAsk, prefs);
  return truncateOddsTo3(1 / cap);
}

/** fo 条目 → 展示/扫描赔率。关：trunc3(fo.odds)；锁盘 0。 */
export function pfEffectiveOddsFromFoEntry(
  entry: { clobPrice?: number; odds?: number; isLock?: boolean } | null | undefined,
  prefs: PfArbPriceBufferPrefs = runtimePrefs,
): number {
  if (!entry || entry.isLock)
    return 0;
  if (!isPfArbPriceBufferActive(prefs))
    return truncateOddsTo3(Number(entry.odds) || 0);
  const raw = rawAskFromFoEntry(entry);
  if (!isValidPredictClobPrice(raw))
    return truncateOddsTo3(Number(entry.odds) || 0);
  return pfEffectiveOddsFromRawAsk(raw, prefs);
}

/**
 * 预检上限辅助（可选）。**bet.ts 不调用**——仍走 resolvePredictFunDetectionMaxPrice。
 * 关：原样返回。开：resolved 已不优于 detectionOdds 则不再乘；仅 raw 卖一才 × multiplier。
 */
export function resolvePredictFunExecMaxPrice(
  resolvedDetectionMax: number,
  detectionOdds: number,
  prefs: PfArbPriceBufferPrefs = runtimePrefs,
): number {
  if (!isPfArbPriceBufferActive(prefs))
    return resolvedDetectionMax;
  if (!isValidPredictClobPrice(resolvedDetectionMax) || !(detectionOdds > 1))
    return resolvedDetectionMax;
  if (predictFunClobMatchesOdds(resolvedDetectionMax, detectionOdds))
    return resolvedDetectionMax;
  const impliedFromResolved = truncateOddsTo3(1 / resolvedDetectionMax);
  if (!(impliedFromResolved > detectionOdds))
    return resolvedDetectionMax;
  return pfExecCapFromRawAsk(resolvedDetectionMax, prefs);
}
