import { shallowReactive } from "vue";
import { rayMatchStage } from "./shared/match_stage";
import { isRayOddCollectable, type RayOddsPayload } from "./shared/save_bets";
import { updateRayMatchRisk } from "./rayMatchRisk";

interface RayMapOutcome {
  winnerId: string;
  loserId: string;
}

/** [changmen 扩展] 仅供展示；复用 odds 响应，不写赔率、订单或 PM 结算状态。 */
const byMatch = shallowReactive(new Map<string, ReadonlyMap<string, RayMapOutcome>>());

export function updateRayMapOutcomes(matchId: string, payload: RayOddsPayload, betRe: RegExp, gameCode?: string | null): void {
  updateRayMatchRisk(matchId, payload, betRe, gameCode);
  const next = new Map<string, RayMapOutcome>();
  const home = payload.team?.find(team => team.pos === 1);
  const away = payload.team?.find(team => team.pos === 2);
  if (String(payload.id ?? "") === matchId && home && away && String(home.team_id) !== String(away.team_id)) {
    const groups = new Map<string, Array<Record<string, unknown>>>();
    for (const row of payload.odds ?? []) {
      const map = rayMatchStage(row.match_stage);
      if (!Number.isSafeInteger(map) || map <= 0 || !row.odds_group_id || !isRayOddCollectable(row, betRe, gameCode))
        continue;
      const key = `${map}:${row.odds_group_id}`;
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }
    for (const [key, rows] of groups) {
      if (rows.length !== 2 || rows.some(row => Number(row.status) !== 5))
        continue;
      const winner = rows.find(row => row.win === 1 || row.win === "1");
      const loser = rows.find(row => row.win === 0 || row.win === "0");
      if (!winner || !loser)
        continue;
      const teamIds = new Set(rows.map(row => String(row.team_id ?? "")));
      const winnerId = String(winner.odds_id ?? ""), loserId = String(loser.odds_id ?? "");
      if (teamIds.size === 2 && teamIds.has(String(home.team_id)) && teamIds.has(String(away.team_id))
        && winnerId && loserId && winnerId !== loserId)
        next.set(key, { winnerId, loserId });
    }
  }
  byMatch.set(matchId, next);
}

/** 盘口 ID 已经由合场对齐，直接匹配双边 ID，避免队名别名或主客反向误标。 */
export function lookupRayMapOutcome(input: {
  matchId: string; betId: string; map: number; homeId: string; awayId: string;
}): "Home" | "Away" | null {
  const outcome = byMatch.get(input.matchId)?.get(`${input.map}:${input.betId}`);
  if (!outcome)
    return null;
  if (outcome.winnerId === input.homeId && outcome.loserId === input.awayId)
    return "Home";
  if (outcome.winnerId === input.awayId && outcome.loserId === input.homeId)
    return "Away";
  return null;
}

export function retainRayMapOutcomes(matchIds: string[]): void {
  const keep = new Set(matchIds);
  for (const id of byMatch.keys()) {
    if (!keep.has(id))
      byMatch.delete(id);
  }
}

export function clearRayMapOutcomes(): void {
  byMatch.clear();
}
