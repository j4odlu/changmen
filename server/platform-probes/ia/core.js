import { matchesMarketCode } from "@changmen/shared/catalog/market_catalog";
import { getGameCode, getGameName } from "./game_ids.js";

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function compileBetName(session) {
  const raw = session?.betName || "([ȫ��].+��ʤ$)|([��ͼ\\d+]\\s*��ʤ��$)";
  return new RegExp(raw);
}

function isAllowedGame(row, gameIds) {
  const id = String(row?.game_type_id ?? "");
  if (!gameIds?.length) return true;
  return gameIds.includes(id);
}

function parseStartTime(raw) {
  if (!raw) return Date.now();
  if (typeof raw === "number") return raw > 1e12 ? raw : raw * 1000;
  const ms = Date.parse(String(raw).replace(" ", "T"));
  return Number.isNaN(ms) ? Date.now() : ms;
}

function pickTeamNames(row) {
  const home =
    row?.team_name_1 ||
    row?.team_a_name ||
    row?.home_team_name ||
    row?.home_name ||
    row?.team1_name ||
    "";
  const away =
    row?.team_name_2 ||
    row?.team_b_name ||
    row?.away_team_name ||
    row?.away_name ||
    row?.team2_name ||
    "";
  return { home: String(home || "����").trim(), away: String(away || "�Ͷ�").trim() };
}

function pickTeamId(row, side) {
  const raw =
    side === "home"
      ? row?.team_id_1 ?? row?.team_a_id ?? row?.home_id ?? row?.home_team_id
      : row?.team_id_2 ?? row?.team_b_id ?? row?.away_id ?? row?.away_team_id;
  if (raw == null) return "";
  const id = String(raw).trim();
  return id || "";
}

export function normalizeListEvent(row, filter = {}) {
  if (!row?.id) return null;
  if (!isAllowedGame(row, filter.gameIds)) return null;

  const gameId = String(row.game_type_id ?? "");
  const teams = pickTeamNames(row);
  const status = row.status ?? row.game_status;
  const isLive = status === 2 || status === "2" || row.is_live === 1 || row.is_live === true;

  return {
    matchId: String(row.id),
    gameId,
    gameCode: getGameCode(gameId),
    gameName: row.game_type_name || row.game_name || getGameName(gameId),
    bo: Number(row.bo || row.best_of || 0) || 0,
    startTime: parseStartTime(row.start_time || row.begin_time || row.game_start_time),
    isLive,
    score: null,
    leagueName: row.league_name || row.event_name || row.match_name || "",
    home: { id: pickTeamId(row, "home"), name: teams.home },
    away: { id: pickTeamId(row, "away"), name: teams.away },
    raw: row,
  };
}

function betKeyFromChild(child) {
  let prefix = "[ȫ��]";
  if (child.match !== 0 && child.match != null) {
    prefix = `[��ͼ${child.match}]`;
  }
  return `${prefix}${child.name || ""}`;
}

function matchesWinBet(child, betNameRegex) {
  const key = betKeyFromChild(child);
  if (matchesMarketCode("IA", "match_winner", { betKey: key })) return true;
  return betNameRegex.test(key);
}

/** status 1=赛前 2=滚球开放；其余视为封盘 */
function iaPointBettable(status) {
  const s = Number(status);
  return s === 1 || s === 2;
}

export function extractStagesFromPlays(plays, betNameRegex) {
  const stages = [];
  for (const play of plays || []) {
    for (const child of play?.child_plays || []) {
      if (!matchesWinBet(child, betNameRegex)) continue;
      const mapNum = Number(child.match) || 0;
      const stageId = mapNum;
      const label = stageId === 0 ? "ȫ��" : `��ͼ${stageId}`;
      const points = child.team_points || [];
      const homePt = points[0];
      const awayPt = points[1];
      const present = [homePt, awayPt].filter((pt) => pt?.id);
      const locked = present.length
        ? present.every((pt) => !iaPointBettable(pt.status))
        : !iaPointBettable(child.status);

      stages.push({
        stageId,
        label,
        winMarketId: String(child.id),
        winHomeId: homePt ? String(homePt.id) : null,
        winAwayId: awayPt ? String(awayPt.id) : null,
        winHome: homePt ? Number(homePt.point) : null,
        winAway: awayPt ? Number(awayPt.point) : null,
        winLocked: locked,
      });
    }
  }
  stages.sort((a, b) => a.stageId - b.stageId);
  return stages;
}

export function registerOddsIndex(oddsIndex, matchId, stages) {
  for (const stage of stages) {
    if (stage.winHomeId) oddsIndex[stage.winHomeId] = { matchId, side: "home", stageId: stage.stageId };
    if (stage.winAwayId) oddsIndex[stage.winAwayId] = { matchId, side: "away", stageId: stage.stageId };
  }
}

export function mergeStagesIntoDetail(detail, stages) {
  detail.stages = stages;
  const full = stages.find((s) => s.stageId === 0) || stages[0];
  if (full) {
    detail.winHome = full.winHome;
    detail.winAway = full.winAway;
    detail.winLocked = full.winLocked;
  }
  detail.marketCount = stages.length;
  detail.updatedAt = Date.now();
}

export function applyWsPointChange(detail, oddsIndex, payload) {
  const pointId = String(payload?.content?.point_id ?? "");
  const odd = Number(payload?.content?.point);
  if (!pointId || Number.isNaN(odd)) return false;

  const ref = oddsIndex[pointId];
  if (!ref || ref.matchId !== detail.matchId) return false;

  for (const stage of detail.stages || []) {
    if (stage.stageId !== ref.stageId) continue;
    if (ref.side === "home" && stage.winHomeId === pointId) {
      stage.winHome = odd;
      stage.winLocked = false;
      detail.winHome = odd;
      detail.winLocked = false;
      detail.updatedAt = Date.now();
      return true;
    }
    if (ref.side === "away" && stage.winAwayId === pointId) {
      stage.winAway = odd;
      stage.winLocked = false;
      detail.winAway = odd;
      detail.winLocked = false;
      detail.updatedAt = Date.now();
      return true;
    }
  }
  return false;
}

export function applyWsBetLock(detail, playId, locked) {
  let touched = false;
  for (const stage of detail.stages || []) {
    if (String(stage.winMarketId) === String(playId)) {
      stage.winLocked = locked;
      touched = true;
    }
  }
  if (touched) {
    detail.winLocked = detail.stages.some((s) => s.winLocked);
    detail.updatedAt = Date.now();
  }
  return touched;
}
