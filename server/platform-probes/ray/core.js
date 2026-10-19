import { rayIsAggregatedOddsRow } from "@changmen/shared/catalog/market_catalog";
import { rayMatchStage as matchStageToId } from "./shared/match_stage.js";

export const DEFAULT_GATEWAYS = [
  "https://cfinfo.365raylinks.com/v2",
  "https://iminfo.esportsworldlink.com/v2",
  "https://cfinfo.365raylines.com/v2",
];

function numberOrZero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function cleanText(v) {
  return String(v ?? "").trim();
}

function parseRayTime(text) {
  const s = cleanText(text);
  if (!s) return 0;
  const t = new Date(s.replace(" ", "T")).getTime();
  return Number.isFinite(t) ? t : 0;
}

function parseBo(round) {
  const m = cleanText(round).match(/bo(\d+)/i);
  return m ? numberOrZero(m[1]) : numberOrZero(round);
}

function stageIdsForBo(bo) {
  const n = Math.max(1, numberOrZero(bo) || 1);
  const ids = [0];
  for (let i = 1; i <= n; i += 1) ids.push(i);
  return ids;
}

function stageLabel(stageId) {
  return stageId === 0 ? "ȫ��" : `��ͼ${stageId}`;
}

function teamLogoUrl(path) {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  return `https://statics.freestaticsasia.com${path.startsWith("/") ? path : `/${path}`}`;
}

function mapWinsFromTeam(row) {
  const sc = row?.score || {};
  let wins = 0;
  for (let i = 1; i <= 7; i += 1) wins += numberOrZero(sc[`r${i}`]);
  return wins;
}

function extractScoreFromTeams(teams) {
  const home = teams.find((t) => numberOrZero(t.pos) === 1);
  const away = teams.find((t) => numberOrZero(t.pos) === 2);
  const homeWins = mapWinsFromTeam(home);
  const awayWins = mapWinsFromTeam(away);
  if (homeWins || awayWins) {
    return { home: homeWins, away: awayWins, text: `${homeWins}:${awayWins}` };
  }
  const manual = home?.score?.manualControlData;
  if (manual && manual.teamAScore != null && manual.teamBScore != null) {
    const h = numberOrZero(manual.teamAScore);
    const a = numberOrZero(manual.teamBScore);
    return { home: h, away: a, text: `${h}:${a}` };
  }
  return { home: 0, away: 0, text: "0:0" };
}

/** RAY �̿� status��1=��Ͷ��������Ϊ���̣��� A8 checkBet һ�£� */
function describeOddStatus(status) {
  const code = numberOrZero(status);
  if (code === 1) return { locked: false, code: "open", label: "��Ͷע" };
  if (code === 4) return { locked: true, code: "closed", label: "�ѹر�" };
  return { locked: true, code: "locked", label: `����(${code})` };
}

function describeMatchStatus(match) {
  const now = Date.now();
  const start = parseRayTime(match.start_time);
  const end = parseRayTime(match.end_time);
  const status = numberOrZero(match.status);
  const score = extractScoreFromTeams(match.team || []);

  let isLive = start > 0 && start <= now && (!end || end > now);
  if (status === 2) isLive = true;

  let code = "scheduled";
  let label = "δ����";
  if (isLive) {
    code = "live";
    label = score.text && score.text !== "0:0" ? `������ ${score.text}` : "������";
  } else if (end && end <= now) {
    code = "ended";
    label = "�ѽ���";
  } else if (start > now) {
    code = "scheduled";
    label = "δ����";
  }

  return {
    isLive: isLive ? 2 : 1,
    code,
    label,
    score: score.text,
    rawStatus: status,
  };
}

function normalizeMatchListItem(raw, options = {}) {
  const teams = raw.team || [];
  const home = teams.find((t) => numberOrZero(t.pos) === 1);
  const away = teams.find((t) => numberOrZero(t.pos) === 2);
  if (!home || !away) return null;

  const gameId = String(raw.game_id);
  if (options.gameIds?.length && !options.gameIds.includes(gameId)) return null;

  const startTime = parseRayTime(raw.start_time);
  const horizonMs = options.horizonMs ?? 7 * 24 * 3600 * 1000;
  const pastMs = options.pastMs ?? 12 * 3600 * 1000;
  const now = Date.now();
  if (startTime && startTime > now + horizonMs) return null;
  if (startTime && startTime < now - pastMs && numberOrZero(raw.status) !== 2) return null;

  const bo = parseBo(raw.round);
  const matchStatus = describeMatchStatus(raw);
  const score = extractScoreFromTeams(teams);

  return {
    matchId: String(raw.id),
    gameId,
    gameName: cleanText(raw.game_name),
    bo,
    startTime,
    endTime: parseRayTime(raw.end_time),
    isLive: matchStatus.isLive === 2,
    liveStatus: matchStatus.label,
    matchStatus: { code: matchStatus.code, label: matchStatus.label, rawStatus: matchStatus.rawStatus },
    score: score.text,
    home: {
      id: String(home.team_id),
      name: cleanText(home.team_name),
      logo: teamLogoUrl(home.team_logo),
    },
    away: {
      id: String(away.team_id),
      name: cleanText(away.team_name),
      logo: teamLogoUrl(away.team_logo),
    },
    tournament: cleanText(raw.tournament_name || raw.tournament_short_name),
    scheduleScope: startTime <= now ? "live" : "upcoming",
    scheduleLabel: startTime <= now ? "����/������" : "δ����",
    raw,
  };
}

function buildOddsBaseline(oddsRows, matchId) {
  const index = {};
  for (const row of oddsRows || []) {
    const id = String(row.odds_id ?? row.id);
    if (!id) continue;
    index[id] = {
      oddsId: id,
      matchId: String(matchId),
      marketId: String(row.odds_group_id),
      marketName: cleanText(row.group_name),
      stageId: matchStageToId(row.match_stage),
      teamId: String(row.team_id),
      odd: Number(row.odds),
      status: numberOrZero(row.status),
      locked: describeOddStatus(row.status).locked,
    };
  }
  return index;
}

function pickWinMarkets(oddsRows) {
  const groups = new Map();
  for (const row of oddsRows || []) {
    if (!rayIsAggregatedOddsRow(row)) continue;
    const stageId = matchStageToId(row.match_stage);
    const gid = `${stageId}:${row.odds_group_id}`;
    if (!groups.has(gid)) {
      groups.set(gid, {
        stageId,
        groupId: String(row.odds_group_id),
        marketName: cleanText(row.group_name),
        rows: [],
      });
    }
    groups.get(gid).rows.push(row);
  }
  return [...groups.values()].sort((a, b) => a.stageId - b.stageId);
}

function buildStagesFromOdds(oddsPayload, homeTeamId, awayTeamId) {
  const oddsRows = oddsPayload?.odds || [];
  const stages = [];
  const oddsIndex = buildOddsBaseline(oddsRows, oddsPayload.id);

  for (const group of pickWinMarkets(oddsRows)) {
    let homeOdd = null;
    let awayOdd = null;
    for (const row of group.rows) {
      const tid = String(row.team_id);
      const entry = {
        oddsId: String(row.odds_id ?? row.id),
        odd: Number(row.odds),
        name: cleanText(row.name),
        status: describeOddStatus(row.status),
      };
      if (tid === String(homeTeamId)) homeOdd = entry;
      if (tid === String(awayTeamId)) awayOdd = entry;
    }
    const locked = Boolean(homeOdd?.status.locked || awayOdd?.status.locked);
    stages.push({
      stageId: group.stageId,
      label: stageLabel(group.stageId),
      winHome: homeOdd?.odd ?? null,
      winAway: awayOdd?.odd ?? null,
      winHomeId: homeOdd?.oddsId ?? null,
      winAwayId: awayOdd?.oddsId ?? null,
      winMarketId: group.groupId,
      winLocked: locked,
      winMarketStatus: homeOdd?.status || awayOdd?.status || describeOddStatus(0),
      winMarket: group.marketName,
      marketCount: group.rows.length,
    });
  }

  const overall = stages.find((s) => s.stageId === 0) || stages[0] || {};
  return {
    stages,
    oddsIndex,
    winHome: overall.winHome ?? null,
    winAway: overall.winAway ?? null,
    winHomeId: overall.winHomeId ?? null,
    winAwayId: overall.winAwayId ?? null,
    winLocked: overall.winLocked ?? true,
    winMarketStatus: overall.winMarketStatus ?? null,
    winMarket: overall.winMarket ?? "",
    marketCount: oddsRows.length,
  };
}

function applyWsOddsUpdates(detail, oddsIndex, updates) {
  let touched = false;
  for (const item of updates || []) {
    const oddsId = String(item.id ?? item.odds_id);
    const row = oddsIndex[oddsId];
    if (!row || !detail?.stages) continue;
    const odd = Number(item.odds);
    const st = describeOddStatus(item.status);
    row.odd = odd;
    row.status = numberOrZero(item.status);
    row.locked = st.locked;

    for (const stage of detail.stages) {
      if (stage.winHomeId === oddsId) {
        stage.winHome = odd;
        stage.winLocked = st.locked;
        stage.winMarketStatus = st;
        touched = true;
      }
      if (stage.winAwayId === oddsId) {
        stage.winAway = odd;
        stage.winLocked = st.locked;
        stage.winMarketStatus = st;
        touched = true;
      }
    }
  }
  if (touched && detail.stages?.length) {
    const overall = detail.stages.find((s) => s.stageId === 0) || detail.stages[0];
    detail.winHome = overall.winHome;
    detail.winAway = overall.winAway;
    detail.winLocked = overall.winLocked;
    detail.winMarketStatus = overall.winMarketStatus;
  }
  return touched;
}

export {
  numberOrZero,
  parseBo,
  stageIdsForBo,
  matchStageToId,
  stageLabel,
  describeOddStatus,
  describeMatchStatus,
  normalizeMatchListItem,
  buildOddsBaseline,
  buildStagesFromOdds,
  applyWsOddsUpdates,
  parseRayTime,
};
