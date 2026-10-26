import type { BetOption } from "@changmen/client-core/models/betOption";
import { getPmSportScoreKind, parsePmSportMapPeriod, type PmSportScoreKind } from "@changmen/shared/pm_sport_score";

/** 与 client_matches.pm_sport / PmSportSnapshot 对齐的最小字段 */
export interface PmSportLike {
  ended?: boolean;
  live?: boolean;
  status?: string;
  bo?: number | null;
  period?: string;
  currentMap?: number | null;
  scoreRaw?: string;
  scoreKind?: PmSportScoreKind;
  mapScore?: { home: number; away: number };
}

export function isPmSportEnded(pm: PmSportLike | null | undefined): boolean {
  if (!pm || typeof pm !== "object")
    return false;
  if (pm.ended === true)
    return true;
  const st = String(pm.status ?? "").trim().toLowerCase();
  return st === "finished" || st === "final" || st === "f/ot";
}

function isPointsScore(pm: PmSportLike): boolean {
  return pm.scoreKind === "points" || getPmSportScoreKind(pm.scoreRaw) === "points";
}

/** [changmen 扩展] 只按明确 BO 判断系列赛；体育得分、缺失 BO 不推断胜局门槛。 */
export function isPmSeriesDecided(pm: PmSportLike | null | undefined): boolean {
  if (!pm?.mapScore || isPointsScore(pm))
    return false;
  const bo = pm.bo;
  if (typeof bo !== "number" || !Number.isSafeInteger(bo) || bo < 2)
    return false;
  const need = Math.ceil(bo / 2);
  const home = Number(pm.mapScore.home) || 0;
  const away = Number(pm.mapScore.away) || 0;
  return home >= need || away >= need;
}

function resolveBetMap(map: number | null | undefined): number {
  const n = Number(map);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * 根据 VPS pm_sport 判断是否应拒单。
 * @returns 拒单原因；null 表示不拦（含无 pm_sport 快照）
 */
export function getPolymarketPmSportBlockReason(
  pm: PmSportLike | null | undefined,
  map: number | null | undefined,
): string | null {
  if (!pm || typeof pm !== "object")
    return null;

  const betMap = resolveBetMap(map);
  const score = pm.mapScore;
  const scoreText = score ? `${score.home}-${score.away}` : "";

  if (isPmSportEnded(pm)) {
    return scoreText
      ? `Polymarket 比赛已结束（${scoreText}）`
      : "Polymarket 比赛已结束";
  }

  if (isPmSeriesDecided(pm)) {
    const bo = pm.bo;
    return `Polymarket 系列赛已决出（${scoreText} BO${bo}）`;
  }

  if (betMap > 0 && !isPointsScore(pm)) {
    const currentMap = pm.currentMap ?? parsePeriodHead(pm.period);
    if (currentMap != null && betMap < currentMap)
      return `Polymarket 地图${betMap}已结束（当前第${currentMap}图）`;
  }

  return null;
}

export function parsePeriodHead(period: string | undefined): number | null {
  return parsePmSportMapPeriod(period);
}

export function getPolymarketPmSportBlockReasonFromOption(option: BetOption): string | null {
  const pm = option.match?.pmSport as PmSportLike | undefined;
  const map = option.bet?.round;
  return getPolymarketPmSportBlockReason(pm, map);
}
