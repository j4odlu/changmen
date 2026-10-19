import { matchesMarketCode, getPlatformRules } from "@changmen/shared/catalog/market_catalog";
import { getGameCode, getGameName } from "./game_ids.js";

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseBo(raw) {
  const m = String(raw || "").match(/BO(\d+)/i);
  if (m) return Number(m[1]) || 0;
  return 0;
}

export function parseStartTime(raw) {
  if (!raw) return Date.now();
  const normalized = String(raw).replace(" ", "T");
  const ms = Date.parse(normalized);
  return Number.isNaN(ms) ? Date.now() : ms;
}

function parseScoreline(raw) {
  if (!raw || typeof raw !== "string") return null;
  const m = raw.match(/(\d+)\s*:\s*(\d+)/);
  if (!m) return null;
  return { home: Number(m[1]), away: Number(m[2]) };
}

export function stageFromTabName(tabName) {
  const name = String(tabName || "").trim();
  if (!name || name === "MATCH") return { stageId: 0, label: "ȫ��", mapOption: "", marketOption: "MATCH" };
  const mapMatch = name.match(/^MAP\s*(\d+)$/i);
  if (mapMatch) {
    const n = Number(mapMatch[1]);
    return { stageId: n, label: `��ͼ${n}`, mapOption: name, marketOption: "MAP" };
  }
  return null;
}

function isAllowedGame(event, gameIds) {
  const id = String(event?.game_id ?? "");
  if (!gameIds?.length) return true;
  return gameIds.includes(id);
}

function withinCollectWindow(event, horizonMs = 3600 * 1000) {
  const start = parseStartTime(event.start_datetime);
  return start < Date.now() + horizonMs;
}

export function normalizeListEvent(raw, filter = {}) {
  if (!raw?.event_id) return null;
  if (!isAllowedGame(raw, filter.gameIds)) return null;
  if (!withinCollectWindow(raw, filter.horizonMs)) return null;

  const gameId = String(raw.game_id);
  return {
    matchId: String(raw.event_id),
    gameId,
    gameCode: getGameCode(gameId),
    gameName: raw.game_name || getGameName(gameId),
    bo: parseBo(raw.best_of),
    startTime: parseStartTime(raw.start_datetime),
    isLive: String(raw.in_play) === "true",
    score: parseScoreline(raw.match_scoreline),
    leagueName: raw.competition_name || "",
    home: {
      id: String(raw.home?.team_id ?? ""),
      name: raw.home?.team_name || "",
    },
    away: {
      id: String(raw.away?.team_id ?? ""),
      name: raw.away?.team_name || "",
    },
    marketTabs: Array.isArray(raw.market_tabs) ? raw.market_tabs : [],
    raw,
  };
}

function isAggregatedWinMarket(market, betNameRegex) {
  if (!market) return false;
  if (matchesMarketCode("TF", "match_winner", { row: market, market_name: market.market_name })) {
    return true;
  }
  if (betNameRegex && market.market_name && betNameRegex.test(market.market_name)) {
    return true;
  }
  if (market.bet_type_name === "WIN") {
    return market.market_option === "match" || market.market_option === "map";
  }
  return false;
}

export function selectionOddsId(marketId, selectionName) {
  return `${marketId}:${selectionName}`;
}

function pickSelection(market, side) {
  const rows = market.selection || [];
  return rows.find((s) => s.name === side) || null;
}

function marketLocked(market, selection) {
  if (!selection) return true;
  if (selection.status !== "open") return true;
  if (market.settlement_status === "settled") return true;
  return false;
}

function buildStageFromMarket(market, stageMeta) {
  const homeSel = pickSelection(market, "home");
  const awaySel = pickSelection(market, "away");
  if (!homeSel || !awaySel) return null;

  const marketId = String(market.market_id);
  const locked = marketLocked(market, homeSel) || marketLocked(market, awaySel);
  const stageId = stageMeta?.stageId ?? 0;

  return {
    stageId,
    label: stageMeta?.label || (stageId === 0 ? "ȫ��" : `��ͼ${stageId}`),
    winHome: Number(homeSel.euro_odds) || null,
    winAway: Number(awaySel.euro_odds) || null,
    winHomeId: selectionOddsId(marketId, "home"),
    winAwayId: selectionOddsId(marketId, "away"),
    winMarketId: marketId,
    winLocked: locked,
    winMarketStatus: locked
      ? { code: "locked", label: "����" }
      : { code: "open", label: "��Ͷע" },
    betName: market.market_name,
    mapOption: market.map_option || stageMeta?.mapOption || "",
  };
}

export function extractWinMarketsFromResults(results, betNameRegex) {
  const stages = [];
  const oddsIndex = {};

  for (const block of results || []) {
    for (const market of block.markets || []) {
      if (!isAggregatedWinMarket(market, betNameRegex)) continue;
      const stageMeta = stageFromTabName(market.map_option || (market.market_option === "match" ? "MATCH" : ""));
      const stage = buildStageFromMarket(market, stageMeta || { stageId: Number(market.map_num) || 0 });
      if (!stage) continue;

      const existing = stages.find((s) => s.stageId === stage.stageId);
      if (!existing) stages.push(stage);
      else if (existing.winLocked && !stage.winLocked) Object.assign(existing, stage);

      oddsIndex[stage.winHomeId] = { matchId: null, stageId: stage.stageId, side: "home", odd: stage.winHome };
      oddsIndex[stage.winAwayId] = { matchId: null, stageId: stage.stageId, side: "away", odd: stage.winAway };
    }
  }

  stages.sort((a, b) => a.stageId - b.stageId);
  return { stages, oddsIndex };
}

export function mergeStagesIntoDetail(detail, built) {
  const byStage = new Map((detail.stages || []).map((s) => [s.stageId, s]));
  for (const stage of built.stages) {
    byStage.set(stage.stageId, { ...(byStage.get(stage.stageId) || {}), ...stage });
  }
  detail.stages = [...byStage.values()].sort((a, b) => a.stageId - b.stageId);
  const primary = detail.stages.find((s) => s.stageId === 0) || detail.stages[0];
  if (primary) {
    detail.winHome = primary.winHome;
    detail.winAway = primary.winAway;
    detail.winHomeId = primary.winHomeId;
    detail.winAwayId = primary.winAwayId;
    detail.winMarketId = primary.winMarketId;
    detail.winLocked = primary.winLocked;
    detail.winMarketStatus = primary.winMarketStatus;
    detail.marketCount = detail.stages.length;
  }
  return detail;
}

export function registerOddsIndex(oddsIndex, matchId, built) {
  for (const stage of built.stages) {
    oddsIndex[stage.winHomeId] = {
      matchId,
      stageId: stage.stageId,
      side: "home",
      marketId: stage.winMarketId,
    };
    oddsIndex[stage.winAwayId] = {
      matchId,
      stageId: stage.stageId,
      side: "away",
      marketId: stage.winMarketId,
    };
  }
}

export function applyWsOddsUpdates(detail, oddsIndex, payload) {
  const data = payload?.data;
  if (!data?.selection || !data.market_id) return false;

  const marketId = String(data.market_id);
  let touched = false;

  for (const sel of data.selection) {
    const oddsId = selectionOddsId(marketId, sel.name);
    const ref = oddsIndex[oddsId];
    if (!ref || ref.matchId == null) continue;

    const stage = detail.stages?.find((s) => s.stageId === ref.stageId);
    if (!stage) continue;

    const locked = sel.status !== "open";
    const odd = Number(sel.euro_odds);
    if (ref.side === "home") {
      stage.winHome = odd;
      stage.winHomeId = oddsId;
      stage.winLocked = locked;
    } else if (ref.side === "away") {
      stage.winAway = odd;
      stage.winAwayId = oddsId;
      stage.winLocked = locked;
    }
    touched = true;
  }

  if (touched) {
    const primary = detail.stages.find((s) => s.stageId === 0) || detail.stages[0];
    if (primary) {
      detail.winHome = primary.winHome;
      detail.winAway = primary.winAway;
      detail.winLocked = primary.winLocked;
    }
    detail.updatedAt = Date.now();
  }
  return touched;
}

export function compileBetName(session) {
  const rules = getPlatformRules("TF");
  const pattern = session?.betName || rules?.betName;
  if (!pattern) return null;
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}
