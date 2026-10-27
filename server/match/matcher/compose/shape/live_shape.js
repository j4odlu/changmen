/**
 * 展示成形：trim / strip / 命名 / 排序。
 *
 * Round / BO / periods 由 structure/resolve_structure.js 在投影前定型，此处只读。
 */
import { parseTitleTeams } from "@changmen/match-identity/teams/match_utils.js";
import { findPlatformMatch } from "../sides/orientation_lock.js";

const MIN_PLATFORMS = 2;

export function preserveInitialOddsFromSources(bet) {
  if (!bet)
    return;
  let home = Number(bet.InitialHomeOdds) || 0;
  let away = Number(bet.InitialAwayOdds) || 0;
  for (const src of Object.values(bet.Sources || {})) {
    if (!src)
      continue;
    home = Math.max(home, Number(src.HomeOdds) || 0);
    away = Math.max(away, Number(src.AwayOdds) || 0);
  }
  if (home > 0)
    bet.InitialHomeOdds = home;
  if (away > 0)
    bet.InitialAwayOdds = away;
}

/**
 * live Round>0：Map0 仅保留当时还在 Sources 里的全场盘馆。
 * [A8 可证实] OB；[changmen 扩展] Polymarket / PredictFun / Limitless。
 * PM 在 Round===BO 时已由 project_sources 从 Map0 剥到决胜局，此处只保留、不加回。
 * trim 前保全 Initial*。
 */
export function trimMapZeroLive(rows) {
  for (const row of rows || []) {
    const liveMap = Number(row.Round) || 0;
    if (liveMap <= 0)
      continue;
    const fullBet = (row.Bets || []).find(b => (Number(b.Map) || 0) === 0);
    if (!fullBet)
      continue;
    preserveInitialOddsFromSources(fullBet);
    const kept = {};
    if (fullBet.Sources?.OB)
      kept.OB = fullBet.Sources.OB;
    if (fullBet.Sources?.Polymarket)
      kept.Polymarket = fullBet.Sources.Polymarket;
    if (fullBet.Sources?.PredictFun)
      kept.PredictFun = fullBet.Sources.PredictFun;
    if (fullBet.Sources?.Limitless)
      kept.Limitless = fullBet.Sources.Limitless;
    fullBet.Sources = kept;
  }
}

export function stripOrphanPlatforms(rows, platformMatches) {
  for (const row of rows || []) {
    if (row?.Matchs && typeof row.Matchs === "object") {
      for (const [plat, srcId] of Object.entries({ ...row.Matchs })) {
        if (!findPlatformMatch(platformMatches, plat, srcId))
          delete row.Matchs[plat];
      }
    }
    if (!Array.isArray(row?.Bets))
      continue;
    for (const bet of row.Bets) {
      if (!bet?.Sources)
        continue;
      for (const plat of Object.keys(bet.Sources)) {
        const srcId = row.Matchs?.[plat];
        if (!srcId || !findPlatformMatch(platformMatches, plat, srcId))
          delete bet.Sources[plat];
      }
    }
    row.Bets = row.Bets.filter((b) => {
      if (Object.keys(b.Sources || {}).length > 0)
        return true;
      const map = Number(b.Map) || 0;
      if (map !== 0)
        return false;
      const liveMap = Number(row.Round) || 0;
      if (liveMap <= 0)
        return false;
      return (Number(b.InitialHomeOdds) || 0) > 0 || (Number(b.InitialAwayOdds) || 0) > 0;
    });
    const platformsWithSources = new Set();
    for (const bet of row.Bets || []) {
      for (const p of Object.keys(bet.Sources || {}))
        platformsWithSources.add(p);
    }
    if (Array.isArray(row.Reverse))
      row.Reverse = row.Reverse.filter(p => platformsWithSources.has(p));
  }
}

export function refreshBetNames(rows) {
  for (const row of rows || []) {
    const teams = parseTitleTeams(row.Title);
    for (const bet of row.Bets || []) {
      if (teams) {
        bet.HomeName = teams.home;
        bet.AwayName = teams.away;
      }
      const map = Number(bet.Map) || 0;
      if (!bet.Name) {
        bet.Name = map === 0 ? "全场-获胜" : `[地图${map}]-单局-获胜`;
      }
      if (row.ID != null)
        bet.MatchID = Number(row.ID);
    }
  }
}

export function sortBets(rows) {
  for (const row of rows || []) {
    if (!Array.isArray(row.Bets) || row.Bets.length < 2)
      continue;
    row.Bets.sort((a, b) => (Number(a.Map) || 0) - (Number(b.Map) || 0));
  }
}

/** strip 后仍不足多馆的场剔除；进行中（Round>0）允许暂留单馆，避免源抖动误归档 */
export function filterMultiPlatform(rows, minPlatforms = MIN_PLATFORMS) {
  const min = Math.max(1, Number(minPlatforms) || MIN_PLATFORMS);
  return (rows || []).filter((r) => {
    const n = Object.keys(r?.Matchs || {}).length;
    if (n >= min)
      return true;
    // live：至少还剩 1 馆则保留，等缺席馆恢复
    if (n >= 1 && (Number(r?.Round) || 0) > 0)
      return true;
    return false;
  });
}

/** 投影后：trim → strip → 命名 → 排序 */
export function applyLiveShape(rows, { matches } = {}) {
  trimMapZeroLive(rows);
  stripOrphanPlatforms(rows, matches);
  refreshBetNames(rows);
  sortBets(rows);
  return rows;
}
