import { runMatchPass } from "./pipeline.js";
import { findPlatformMatch } from "./sides/orientation_lock.js";
import { matchingPlatformSources } from "../lib/match_lifecycle.js";
import { swapBetSource } from "./util/swap.ts";
import { refreshBetNames } from "./shape/live_shape.js";

function fromStoredRow(row) {
  return { ID: Number(row.id), MergeKey: row.merge_key, Title: row.title, Game: row.game,
    GameID: row.game_id, StartTime: Number(row.start_time), BO: row.bo, Round: row.round,
    RoundStart: row.round_start, Matchs: { ...row.matchs }, Bets: structuredClone(row.bets || []),
    Reverse: [...(row.reverse || [])], HomeGbTeamId: row.home_gb_team_id, AwayGbTeamId: row.away_gb_team_id };
}

/** 缺席场馆只锁盘口，保留匹配关系；是否结束由现有 End 规则决定。 */
function retainUnavailableSources(current, previous, matches) {
  if (!previous) return current;
  const links = { ...previous.matchs, ...current.Matchs };
  const missing = new Set(Object.entries(links)
    .filter(([platform, sid]) => !findPlatformMatch(matches, platform, sid)).map(([platform]) => platform));
  const reversed = new Set(current.Reverse || []);
  const flip = previous.home_gb_team_id && previous.away_gb_team_id
    && String(previous.home_gb_team_id) === String(current.AwayGbTeamId)
    && String(previous.away_gb_team_id) === String(current.HomeGbTeamId);
  for (const platform of missing)
    if ((previous.reverse || []).includes(platform) !== !!flip) reversed.add(platform);
  for (const old of previous.bets || []) {
    const sources = Object.fromEntries(Object.entries(old.Sources || {})
      .filter(([platform]) => missing.has(platform)
        && String(previous.matchs?.[platform]) === String(links[platform]))
      .map(([platform, source]) => [platform, { ...(flip ? swapBetSource(source) : source),
        Type: platform, Status: "Locked", HomeID: "", AwayID: "", HomeOdds: 0, AwayOdds: 0 }]));
    if (!Object.keys(sources).length) continue;
    let bet = current.Bets.find(b => Number(b.Map) === Number(old.Map));
    if (!bet) { bet = { ...structuredClone(old), Sources: {} }; current.Bets.push(bet); }
    Object.assign(bet.Sources, sources);
  }
  current.Matchs = links;
  current.Reverse = [...reversed];
  refreshBetNames([current]);
  current.Bets.sort((a, b) => Number(a.Map) - Number(b.Map));
  return current;
}

/** 刷新未结束的已有比赛；不新增另一套显示/隐藏判定。 */
export function refreshExistingMatches(info, snapshot, { endedIds = [], ...opts } = {}) {
  const ended = new Set(endedIds.map(Number));
  const existing = (snapshot.clientRows || []).filter(r => r.ended_at == null && r.endedAt == null);
  const byId = new Map(info.map(m => [Number(m.ID), structuredClone(m)]));
  const matches = matchingPlatformSources(snapshot.matches, snapshot.clientRows || []);
  const gaps = [];
  for (const row of existing) {
    const id = Number(row.id);
    if (byId.has(id) || ended.has(id)) continue;
    const match = fromStoredRow(row);
    match.Matchs = Object.fromEntries(Object.entries(match.Matchs)
      .filter(([platform, sid]) => findPlatformMatch(matches, platform, sid)));
    if (Object.keys(match.Matchs).length) gaps.push(match);
    else byId.set(id, fromStoredRow(row));
  }
  if (gaps.length) {
    const pass = runMatchPass(gaps, { ...snapshot, matches }, { ...opts, allowExistingSingle: true });
    for (const match of pass.info) byId.set(Number(match.ID), match);
  }
  const previousById = new Map(existing.map(row => [Number(row.id), row]));
  return [...byId.values()].filter(row => !ended.has(Number(row.ID))).map(row =>
    retainUnavailableSources(row, previousById.get(Number(row.ID)), matches));
}
