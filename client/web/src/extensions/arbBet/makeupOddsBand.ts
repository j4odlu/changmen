/**
 * [changmen 扩展] 补单上下沿（赔率系数 / 总体利润率二选一）。
 * 默认关：补单消费 / anyOdds 重试仍走 config.makeProfit。
 * 开启后按所选模式替代补单消费 / 拒单即时重试门槛（入队 B() 在开启时跳过；手动补单、PM 续查不碰）。
 *
 * 赔率系数模式按「已成腿打平赔率 × 系数」，不是初赔/当前赔率。
 * 例：已成 2 → 打平 2，默认 [2×0.96, 2×1.02] = [1.92, 2.04] 内不补。
 * 利润率模式按整数计划金额计算两侧较低返还对应的总体保底利润率。
 */
import type { MakeupOddsBandDisplay } from "@/types/order";
import { toFixed } from "@changmen/client-core/shared/format";
import { calcBreakEvenOdds } from "@/domain/betting/makeupStakeCalc";
import { normalizeMakeupOddsBand, type MakeupOddsBandPrefs } from "@/types/extensionPrefs";

export function isMakeupOddsBandEnabled(
  prefs: MakeupOddsBandPrefs | null | undefined,
): boolean {
  return prefs?.enabled === true;
}

function scaleBreakEvenOdds(breakEven: number, factor: number): number | null {
  const scaled = breakEven * factor;
  if (!(scaled > 1) || !Number.isFinite(scaled))
    return null;
  return Number(toFixed(scaled));
}

export interface MakeupOddsBandBounds {
  breakEvenOdds: number;
  upperOdds: number;
  /** null = 下沿关闭：不高于上沿一律不补 */
  lowerOdds: number | null;
}

export interface MakeupProfitRateContext<T> {
  /** 已成交腿金额，与 getMakeupStake 返回值须为同一币种口径（当前为 Plan CNY） */
  filledStake: number;
  /** 当前候选赔率对应的计划补单金额 */
  getMakeupStake: (item: T, odds: number) => number;
}

/** 补单后两侧按较低返还计算的总体保底利润率；0.04 = 4%。 */
export function calcMakeupPlanProfitRate(
  filledStake: number,
  filledOdds: number,
  makeupStake: number,
  makeupOdds: number,
): number | null {
  const refStake = Number(filledStake);
  const refOdds = Number(filledOdds);
  const hedgeStake = Number(makeupStake);
  const hedgeOdds = Number(makeupOdds);
  if (!(refStake > 0) || !(refOdds > 1) || !(hedgeStake > 0) || !(hedgeOdds > 1))
    return null;
  const totalStake = refStake + hedgeStake;
  const minPayout = Math.min(refStake * refOdds, hedgeStake * hedgeOdds);
  const rate = (minPayout - totalStake) / totalStake;
  return Number.isFinite(rate) ? rate : null;
}

export function isMakeupProfitRateMode(prefs: MakeupOddsBandPrefs | null | undefined): boolean {
  return normalizeMakeupOddsBand(prefs).mode === "profitRate";
}

function isProfitRateOutsideBand(rate: number, prefs: MakeupOddsBandPrefs): boolean {
  const normalized = normalizeMakeupOddsBand(prefs);
  const upper = Number(normalized.upperProfitPct) / 100;
  const lower = -Number(normalized.lowerLossPct) / 100;
  return rate > upper || rate < lower;
}

/** 场馆校验更新赔率/金额后复检利润率模式；null 表示数据不足。 */
export function checkMakeupProfitRateCandidate(
  filledStake: number,
  filledOdds: number,
  makeupStake: number,
  makeupOdds: number,
  prefs: MakeupOddsBandPrefs,
): { allowed: boolean; rate: number } | null {
  const rate = calcMakeupPlanProfitRate(filledStake, filledOdds, makeupStake, makeupOdds);
  if (rate == null)
    return null;
  return { allowed: isProfitRateOutsideBand(rate, prefs), rate };
}

export function resolveMakeupOddsBandBounds(
  filledOdds: number,
  rawPrefs: MakeupOddsBandPrefs,
): MakeupOddsBandBounds | null {
  const prefs = normalizeMakeupOddsBand(rawPrefs);
  const breakEvenOdds = calcBreakEvenOdds(filledOdds);
  if (breakEvenOdds == null)
    return null;
  const upperOdds = scaleBreakEvenOdds(breakEvenOdds, prefs.upper);
  if (upperOdds == null)
    return null;
  if (!(Number(prefs.lower) > 0))
    return { breakEvenOdds, upperOdds, lowerOdds: null };
  const lowerOdds = scaleBreakEvenOdds(breakEvenOdds, prefs.lower);
  if (lowerOdds == null || lowerOdds >= upperOdds)
    return { breakEvenOdds, upperOdds, lowerOdds: null };
  return { breakEvenOdds, upperOdds, lowerOdds };
}

function inMakeupOddsBand(odds: number, bounds: MakeupOddsBandBounds): boolean {
  if (!(odds > 0))
    return true;
  if (odds > bounds.upperOdds)
    return false;
  if (bounds.lowerOdds == null)
    return true;
  return odds >= bounds.lowerOdds;
}

/**
 * `sortedDesc` 须已按补单侧赔率从高到低排。
 * 最高价在带内 → `[]`（本轮不补，不落到更差的馆）；
 * 最高价高于上沿 → 只保留仍高于上沿的候选；
 * 最高价低于下沿 → 全部保留（从最好的亏价开始）；
 * 打平无解 → `null`（调用方回退 makeProfit）。
 */
export function filterMakeupOddsBandCandidates<T>(
  sortedDesc: T[],
  getOdds: (item: T) => number,
  filledOdds: number,
  prefs: MakeupOddsBandPrefs,
  profitContext?: MakeupProfitRateContext<T>,
): T[] | null {
  if (!sortedDesc.length)
    return [];
  const normalized = normalizeMakeupOddsBand(prefs);
  if (normalized.mode === "profitRate") {
    if (!profitContext)
      return null;
    const getRate = (item: T): number | null => {
      const odds = getOdds(item);
      return calcMakeupPlanProfitRate(
        profitContext.filledStake,
        filledOdds,
        profitContext.getMakeupStake(item, odds),
        odds,
      );
    };
    const bestRate = getRate(sortedDesc[0]);
    if (bestRate == null)
      return null;
    const upper = Number(normalized.upperProfitPct) / 100;
    const lower = -Number(normalized.lowerLossPct) / 100;
    if (bestRate >= lower && bestRate <= upper)
      return [];
    if (bestRate > upper) {
      return sortedDesc.filter((item) => {
        const rate = getRate(item);
        return rate != null && rate > upper;
      });
    }
    return sortedDesc;
  }
  const bounds = resolveMakeupOddsBandBounds(filledOdds, prefs);
  if (!bounds)
    return null;
  const best = getOdds(sortedDesc[0]);
  if (inMakeupOddsBand(best, bounds))
    return [];
  if (best > bounds.upperOdds)
    return sortedDesc.filter(item => getOdds(item) > bounds.upperOdds);
  return sortedDesc;
}

export function previewMakeupOddsBand(
  filledOdds: number,
  prefs: MakeupOddsBandPrefs,
): MakeupOddsBandBounds | null {
  return resolveMakeupOddsBandBounds(filledOdds, prefs);
}

export type { MakeupOddsBandDisplay } from "@/types/order";

/** [changmen 扩展] 自动补单行的上下沿展示；只提供参考，不参与候选过滤。 */
export function makeupDisplayBand(
  order: { betOdds: number; isCreateOrder: boolean },
  rawPrefs?: MakeupOddsBandPrefs | null,
): MakeupOddsBandDisplay | null {
  if (order.isCreateOrder || !isMakeupOddsBandEnabled(rawPrefs) || !rawPrefs)
    return null;
  const prefs = normalizeMakeupOddsBand(rawPrefs);
  if (prefs.mode !== "profitRate") {
    const bounds = resolveMakeupOddsBandBounds(order.betOdds, prefs);
    return bounds ? { ...bounds, approximate: false } : null;
  }
  const breakEvenOdds = calcBreakEvenOdds(order.betOdds);
  if (breakEvenOdds == null)
    return null;
  // 等返还时 1 / 已成赔率 + 1 / 补单赔率 = 1 / (1 + 总体利润率)。
  const oddsAtRate = (rate: number): number | null => {
    if (!(1 + rate > 0))
      return null;
    const implied = 1 / (1 + rate) - 1 / order.betOdds;
    if (!(implied > 0))
      return null;
    const odds = 1 / implied;
    return Number.isFinite(odds) && odds > 1 ? Number(toFixed(odds)) : null;
  };
  return {
    breakEvenOdds,
    upperOdds: oddsAtRate(Number(prefs.upperProfitPct) / 100),
    lowerOdds: oddsAtRate(-Number(prefs.lowerLossPct) / 100),
    approximate: true,
  };
}

/**
 * 侧栏 / 提示用的展示赔率。关上下沿或手动补单：与 A8 相同 `getOdds(makeProfit)`。
 * 开着时展示打平价（带子中轴），公式失败则回退 makeProfit。
 */
export function makeupDisplayOdds(
  order: { betOdds: number; isCreateOrder: boolean; getOdds: (p?: number) => number },
  makeProfit: number,
  bandPrefs?: MakeupOddsBandPrefs | null,
): number {
  if (order.isCreateOrder || !isMakeupOddsBandEnabled(bandPrefs) || !bandPrefs)
    return order.getOdds(makeProfit);
  const bounds = resolveMakeupOddsBandBounds(order.betOdds, bandPrefs);
  return bounds?.breakEvenOdds ?? order.getOdds(makeProfit);
}
