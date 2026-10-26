/** [changmen 扩展] PM 比分格式：电竞「局内分|地图胜局|BO」，体育「主队得分-客队得分」。 */
export type PmSportScoreKind = "series" | "points";

const SCORE_PAIR = /^(\d+)\s*-\s*(\d+)$/;

export function getPmSportScoreKind(score: unknown): PmSportScoreKind | undefined {
  const raw = String(score ?? "").trim();
  if (raw.includes("|"))
    return "series";
  return SCORE_PAIR.test(raw) ? "points" : undefined;
}

/** mapScore 保留旧接口；调用方须结合 scoreKind / BO 使用，不能把体育得分视为胜局。 */
export function parsePmSportScore(score: unknown): {
  mapScore: { home: number; away: number };
  bo: number | null;
} {
  const raw = String(score ?? "").trim();
  const parts = raw.split("|");
  const kind = getPmSportScoreKind(raw);
  const pair = SCORE_PAIR.exec((kind === "series" ? parts[1] ?? "" : raw).trim());
  const home = pair ? Number(pair[1]) : 0;
  const away = pair ? Number(pair[2]) : 0;
  const boMatch = kind === "series" ? /^bo\s*(\d+)$/i.exec((parts[2] ?? "").trim()) : null;
  const bo = boMatch ? Number(boMatch[1]) : null;
  return {
    mapScore: Number.isSafeInteger(home) && Number.isSafeInteger(away) ? { home, away } : { home: 0, away: 0 },
    bo: bo !== null && Number.isSafeInteger(bo) && bo > 0 ? bo : null,
  };
}

/** 只接受明确数字地图编号；1Q / 2H / OT 等体育阶段不能截取为地图。 */
export function parsePmSportMapPeriod(period: unknown): number | null {
  const match = /^(\d+)(?:\/(\d+))?$/.exec(String(period ?? "").trim());
  if (!match)
    return null;
  const map = Number(match[1]);
  const total = match[2] === undefined ? map : Number(match[2]);
  return Number.isSafeInteger(map) && map > 0 && Number.isSafeInteger(total) && total >= map ? map : null;
}
