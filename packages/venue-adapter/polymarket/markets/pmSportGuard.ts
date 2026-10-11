import type { BetOption } from "@changmen/client-core/models/betOption";

/** 与 client_matches.pm_sport / PmSportSnapshot 对齐的最小字段 */
export interface PmSportLike {
  ended?: boolean;
  live?: boolean;
  status?: string;
  bo?: number | null;
  period?: string;
  currentMap?: number | null;
  mapScore?: { home: number; away: number };
}

export function isPmSportEnded(pm: PmSportLike | null | undefined): boolean {
  if (!pm || typeof pm !== "object")
    return false;
  if (pm.ended === true)
    return true;
  const st = String(pm.status ?? "").toLowerCase();
  return st === "finished" || st === "final";
}

/** BO3 等：一方地图胜场已达 ceil(bo/2) */
export function isPmSeriesDecided(pm: PmSportLike | null | undefined): boolean {
  if (!pm?.mapScore)
    return false;
  const bo = pm.bo ?? 3;
  if (!Number.isFinite(bo) || bo < 2)
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
    const bo = pm.bo ?? 3;
    return `Polymarket 系列赛已决出（${scoreText} BO${bo}）`;
  }

  if (betMap > 0) {
    const currentMap = pm.currentMap ?? parsePeriodHead(pm.period);
    if (currentMap != null && betMap < currentMap)
      return `Polymarket 地图${betMap}已结束（当前第${currentMap}图）`;
  }

  return null;
}

export function parsePeriodHead(period: string | undefined): number | null {
  if (!period)
    return null;
  const head = String(period).split("/")[0];
  const n = Number.parseInt(head, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function getPolymarketPmSportBlockReasonFromOption(option: BetOption): string | null {
  const pm = option.match?.pmSport as PmSportLike | undefined;
  const map = option.bet?.round;
  return getPolymarketPmSportBlockReason(pm, map);
}
