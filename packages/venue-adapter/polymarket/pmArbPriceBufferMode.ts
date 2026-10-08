import { truncateOddsTo3 } from "@changmen/shared/odds_format";
import { isValidClobPrice, polymarketClobMatchesOdds } from "./pmDetection";
import { transformPmPrice, type PmPriceQuoteResult } from "./priceQuote";
import { pmTickBufferTick } from "./pmTickMetadata";
export * from "./priceQuote";

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
const policyListeners = new Set<() => void>();
export * from "./pmTickBuffer";
export function isPmTickBufferActive(prefs: PmArbPriceBufferPrefs = runtimePrefs): boolean {
  return prefs.enabled === true && prefs.mode === "tick";
}
export function onPmTickBufferModeChange(listener: (enabled: boolean) => void): () => void {
  modeListeners.add(listener);
  return () => { modeListeners.delete(listener); };
}
/** [changmen 扩展] 转换规则更新后统一通知报价消费者；与 tick 元数据预取分开。 */
export function onPmPricePolicyChange(listener: () => void): () => void {
  policyListeners.add(listener);
  return () => { policyListeners.delete(listener); };
}

let runtimePrefs: PmArbPriceBufferPrefs = {
  enabled: false,
  multiplier: DEFAULT_MULTIPLIER,
};

export function setPmArbPriceBufferPrefs(prefs: PmArbPriceBufferPrefs): void {
  const wasTick = isPmTickBufferActive();
  const previous = runtimePrefs;
  runtimePrefs = {
    enabled: prefs.enabled === true,
    multiplier: normalizePmArbPriceBufferMultiplier(prefs.multiplier),
    ...(prefs.mode === "tick" ? { mode: "tick" as const } : {}),
  };
  const tick = isPmTickBufferActive();
  if (tick !== wasTick) for (const listener of modeListeners) listener(tick);
  if (previous.enabled !== runtimePrefs.enabled || previous.mode !== runtimePrefs.mode
    || previous.multiplier !== runtimePrefs.multiplier)
    for (const listener of policyListeners) listener();
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
  const result = transformPmPrice("", rawAsk, prefs);
  return result.status === "ready" ? result.quote.cap : rawAsk;
}

/** [changmen 扩展] 原始行情 + 配置 + 独立元数据 → 统一报价，不写回原始行情。 */
export function resolvePmDisplayQuote(
  tokenId: string,
  entry: { clobPrice?: number; odds?: number; isLock?: boolean } | undefined,
  prefs: PmArbPriceBufferPrefs = runtimePrefs,
): PmPriceQuoteResult {
  if (!entry || entry.isLock) return { status: "locked" };
  const rawAsk = isPmTickBufferActive(prefs) ? Number(entry.clobPrice) : rawAskFromFoEntry(entry);
  return transformPmPrice(tokenId, rawAsk, prefs, isPmTickBufferActive(prefs) ? pmTickBufferTick(tokenId) : undefined);
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
  const result = resolvePmDisplayQuote("", entry, prefs);
  return result.status === "ready" ? result.quote.displayOdds : truncateOddsTo3(Number(entry.odds) || 0);
}

/**
 * 旧调用方的上限辅助（可选）。**bet.ts 不调用**——统一报价使用精确 cap，提交使用预检冻结上限。
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
