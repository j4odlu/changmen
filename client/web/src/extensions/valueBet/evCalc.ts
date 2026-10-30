/**
 * 纯计算函数 — 去vig + edge 计算（与 server/value-bet/engine/fair_odds.js 相同逻辑）。
 */
import type { ValueBetCalcOpts } from "./evConfig";
import { normalizePmMaxOverroundPct } from "./evConfig";

export interface FairOdds {
  fairHome: number;
  fairAway: number;
  overround: number;
}

export function removVig(homeOdds: number, awayOdds: number, allowZeroVig = false): FairOdds | null {
  if (!Number.isFinite(homeOdds) || !Number.isFinite(awayOdds) || homeOdds <= 1 || awayOdds <= 1)
    return null;
  const ih = 1 / homeOdds;
  const ia = 1 / awayOdds;
  const or = ih + ia;
  if (or < 1 || (or === 1 && !allowZeroVig))
    return null;
  return { fairHome: 1 / (ih / or), fairAway: 1 / (ia / or), overround: or };
}

/** 标记与落单共用的基准质量门槛；PM 允许零水位，超过配置上限时不可作为基准。 */
export function valueBetFairOdds(
  homeOdds: number,
  awayOdds: number,
  opts: Pick<ValueBetCalcOpts, "sharp" | "pmMaxOverroundPct">,
): FairOdds | null {
  const isPm = opts.sharp === "Polymarket";
  const fair = removVig(homeOdds, awayOdds, isPm);
  if (!fair)
    return null;
  // 容忍浮点计算误差，等于上限时允许。
  if (isPm && (fair.overround - 1) * 100 > normalizePmMaxOverroundPct(opts.pmMaxOverroundPct) + 1e-10)
    return null;
  return fair;
}

export function calcEdge(softOdds: number, fairOdds: number): number {
  if (!softOdds || !fairOdds || softOdds <= 1 || fairOdds <= 1)
    return 0;
  return softOdds / fairOdds - 1;
}
