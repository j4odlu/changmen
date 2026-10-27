/**
 * N3 sport 合并：当次列表内存合并（API）+ 异步落库。
 * 足球：按 (market_code, line) 多 Bet；列表展示全部让球/大小线。
 * 禁止触碰电竞 client_matches / platform_* / team_db。
 */
import {
  pruneSportVenueSnapshot,
  replaceSportClientMatches,
  setSportVenueMatchId,
  upsertSportVenueBets,
  upsertSportVenueMatches,
} from "@changmen/db";
import { createSportTeamPlugin } from "@changmen/team-resolver/sport_team_plugin";
import {
  clientMatchDtosToSportVenueRows,
  sportMergedMatchId,
} from "./sport_venue_ingest.js";
import {
  FOOTBALL_FALLBACK_GAMES,
  FOOTBALL_LEAGUE_CODES,
  MARKET_MONEYLINE,
  MARKET_SPREADS,
  MARKET_TOTALS,
  UNKNOWN_FOOTBALL_GAME,
  displayBetName,
  encodeSportBetId,
  isFootballOutcomeLabelName,
  isFootballTotalsMarketCode,
  marketBetKey,
  orientSpreadLine,
  parseFootballTitleTeams,
  selectFootballDisplayBets,
  sanitizeFootballMatchList,
  stripFootballHandicapSuffix,
} from "./sport_football_markets.js";

const VENUE_PRIORITY = ["Polymarket", "PredictFun", "OB"];

/** 足球兜底腿配对用中性键；真实联赛仍按各自 Game 硬隔离（软挂已关，见 FOOTBALL_FALLBACK_GAMES） */
const FOOTBALL_SOFT_PAIR_GAME = "_fb_soft";

/** @type {ReturnType<typeof createSportTeamPlugin>} */
const sportTeams = createSportTeamPlugin({
  games: ["mlb", "kbo", "npb", "soccer", "tennis", "nba", FOOTBALL_SOFT_PAIR_GAME, ...FOOTBALL_LEAGUE_CODES],
});

function gameCodeForSport(sport, legGame) {
  if (legGame)
    return String(legGame);
  const s = String(sport);
  if (s === "football")
    return UNKNOWN_FOOTBALL_GAME;
  if (s === "tennis")
    return "tennis";
  if (s === "basketball")
    return "nba";
  if (s === "baseball")
    return "mlb";
  return "mlb";
}

/**
 * 足球配对 Game：真实联赛硬隔离；仅 FOOTBALL_FALLBACK_GAMES（现为空）可走软桶。
 * @param {boolean} isFootball
 * @param {string} game
 */
function pairGameForSport(isFootball, game) {
  if (!isFootball)
    return game;
  const g = String(game || "").toLowerCase().trim();
  if (FOOTBALL_FALLBACK_GAMES.has(g))
    return FOOTBALL_SOFT_PAIR_GAME;
  return g || UNKNOWN_FOOTBALL_GAME;
}

/**
 * @param {object[]} legs
 * @param {string} fallback
 */
function preferFootballGame(legs, fallback) {
  for (const leg of legs) {
    const g = String(leg?.game || "").toLowerCase().trim();
    if (
      g
      && !FOOTBALL_FALLBACK_GAMES.has(g)
      && g !== "soccer"
      && g !== FOOTBALL_SOFT_PAIR_GAME
      && g !== UNKNOWN_FOOTBALL_GAME
    ) {
      return g;
    }
  }
  return fallback;
}

/**
 * 把仅含兜底联赛的分组挂到同队名+同时段的真实联赛组（chi+uef）。
 * @param {Map<string, object[]>} groups
 */
function attachFootballFallbackGroups(groups) {
  const softKeys = [...groups.keys()].filter((key) => {
    const legs = groups.get(key) || [];
    return legs.length > 0
      && legs.every(l => FOOTBALL_FALLBACK_GAMES.has(String(l.game || "").toLowerCase()));
  });
  for (const softKey of softKeys) {
    const softLegs = groups.get(softKey);
    if (!softLegs?.length)
      continue;
    const probe = softLegs[0];
    const softPair = sportTeams.pairKey(
      probe.home,
      probe.away,
      probe.startTime,
      FOOTBALL_SOFT_PAIR_GAME,
    );
    if (!softPair)
      continue;
    let hostKey = null;
    for (const [hardKey, hardLegs] of groups) {
      if (hardKey === softKey || !hardLegs.length)
        continue;
      if (hardLegs.every(l => FOOTBALL_FALLBACK_GAMES.has(String(l.game || "").toLowerCase())))
        continue;
      const h = hardLegs[0];
      const hardSoft = sportTeams.pairKey(h.home, h.away, h.startTime, FOOTBALL_SOFT_PAIR_GAME);
      if (hardSoft && hardSoft === softPair) {
        hostKey = hardKey;
        break;
      }
    }
    if (!hostKey)
      continue;
    groups.get(hostKey).push(...softLegs);
    groups.delete(softKey);
  }
}

/**
 * @param {object} leg
 * @param {object} src
 */
function buildSourceFromDto(leg, src) {
  const homeOdds = Number(src.HomeOdds) || 0;
  const awayOdds = Number(src.AwayOdds) || 0;
  const locked = String(src.Status || "").toLowerCase() === "locked"
    || !(homeOdds > 0 && awayOdds > 0);
  /** @type {Record<string, string|number>} */
  const out = {
    Type: String(src.Type || leg.venue),
    BetID: String(src.BetID || leg.sourceMatchId),
    HomeID: String(src.HomeID || ""),
    AwayID: String(src.AwayID || ""),
    HomeOdds: homeOdds,
    AwayOdds: awayOdds,
    Status: locked ? "Locked" : "Normal",
  };
  if (src.HomeMarketID != null && String(src.HomeMarketID))
    out.HomeMarketID = String(src.HomeMarketID);
  if (src.AwayMarketID != null && String(src.AwayMarketID))
    out.AwayMarketID = String(src.AwayMarketID);
  if (src.DrawOdds != null && Number(src.DrawOdds) > 0)
    out.DrawOdds = Number(src.DrawOdds);
  if (src.DrawID != null && String(src.DrawID))
    out.DrawID = String(src.DrawID);
  return out;
}

function orientSource(anchorHome, anchorAway, candHome, candAway, src, gameCode, marketCode) {
  if (String(marketCode) === MARKET_TOTALS)
    return { src, flipped: false };
  const ah = sportTeams.resolveKey(anchorHome, gameCode);
  const ch = sportTeams.resolveKey(candHome, gameCode);
  const ca = sportTeams.resolveKey(candAway, gameCode);
  if (ah && ch && ah === ch)
    return { src, flipped: false };
  if (ah && ca && ah === ca) {
    /** @type {Record<string, string|number>} */
    const flipped = {
      ...src,
      HomeID: src.AwayID,
      AwayID: src.HomeID,
      HomeOdds: src.AwayOdds,
      AwayOdds: src.HomeOdds,
    };
    if (src.HomeMarketID != null || src.AwayMarketID != null) {
      flipped.HomeMarketID = src.AwayMarketID != null ? String(src.AwayMarketID) : "";
      flipped.AwayMarketID = src.HomeMarketID != null ? String(src.HomeMarketID) : "";
    }
    return { src: flipped, flipped: true };
  }
  return { src, flipped: false };
}

/**
 * @param {object[]} list
 */
function extractLegs(list) {
  /** @type {object[]} */
  const legs = [];
  for (const m of list || []) {
    for (const bet of m?.Bets || []) {
      const marketCode = String(bet.MarketCode || MARKET_MONEYLINE).toLowerCase();
      const line = bet.Line != null && Number.isFinite(Number(bet.Line))
        ? Number(bet.Line)
        : null;
      for (const [key, src] of Object.entries(bet.Sources || {})) {
        if (!src)
          continue;
        const venue = String(src.Type || key);
        const sourceMatchId = String(
          m.Matchs?.[venue] ?? m.Matchs?.[key] ?? src.BetID ?? m.ID ?? "",
        );
        if (!sourceMatchId)
          continue;
        legs.push({
          venue,
          sourceMatchId,
          home: String(bet.HomeName || ""),
          away: String(bet.AwayName || ""),
          matchTitle: String(m.Title || ""),
          startTime: m.StartTime != null ? Number(m.StartTime) : 0,
          game: m.Game != null ? String(m.Game) : null,
          league: String(m.League || ""),
          marketCode,
          line,
          betName: String(bet.Name || ""),
          src,
        });
      }
    }
  }
  return legs;
}

/**
 * @param {string} sport
 * @param {object[]} list
 */
export function mergeSportClientMatchDtoList(sport, list) {
  const sportKey = String(sport);
  const isFootball = sportKey === "football";
  const legs = extractLegs(list);
  /** @type {Map<string, object[]>} */
  const groups = new Map();

  for (const leg of legs) {
    const game = gameCodeForSport(sportKey, leg.game);
    const pairGame = pairGameForSport(isFootball, game);
    let home = leg.home;
    let away = leg.away;
    if (isFootball) {
      home = stripFootballHandicapSuffix(home) || home;
      away = stripFootballHandicapSuffix(away) || away;
      leg.home = home;
      leg.away = away;
    }
    // 大小球 Home/Away 为 大/小（含 ht_totals）；不能拿去 pairKey，否则同时段未分类场会并成「大 vs 小」
    const totalsLike = isFootball && (
      isFootballTotalsMarketCode(leg.marketCode)
      || isFootballOutcomeLabelName(home)
      || isFootballOutcomeLabelName(away)
    );
    const pairHome = totalsLike ? null : home;
    const pairAway = totalsLike ? null : away;
    let key = null;
    if (pairHome && pairAway)
      key = sportTeams.pairKey(pairHome, pairAway, leg.startTime, pairGame);
    if (!key) {
      // totals：靠 sourceMatchId + game + 时间 挂到同场馆胜负场
      const attach = legs.find(o =>
        o.venue === leg.venue
        && o.sourceMatchId === leg.sourceMatchId
        && o.marketCode === MARKET_MONEYLINE);
      if (attach) {
        const ah = isFootball ? (stripFootballHandicapSuffix(attach.home) || attach.home) : attach.home;
        const aa = isFootball ? (stripFootballHandicapSuffix(attach.away) || attach.away) : attach.away;
        if (ah && aa && !isFootballOutcomeLabelName(ah) && !isFootballOutcomeLabelName(aa)) {
          key = sportTeams.pairKey(ah, aa, attach.startTime || leg.startTime, pairGame);
          leg.home = ah;
          leg.away = aa;
        }
      }
    }
    // PM/PF 让球、大小常是不同 event id；标题已是「主 vs 客」时按队名+开球时间并进同一场
    if (!key && isFootball) {
      const fromTitle = parseFootballTitleTeams(leg.matchTitle);
      if (fromTitle)
        key = sportTeams.pairKey(fromTitle.home, fromTitle.away, leg.startTime, pairGame);
    }
    if (!key) {
      key = `solo|${leg.venue}|${leg.sourceMatchId}`;
    }
    if (!groups.has(key))
      groups.set(key, []);
    groups.get(key).push(leg);
  }

  if (isFootball)
    attachFootballFallbackGroups(groups);

  const builtAt = Date.now();
  const dtos = [];
  const dbRows = [];
  const linkUpdates = [];
  let multiVenueCount = 0;

  function emitGroup(pairKey, groupLegs) {
    if (!groupLegs.length)
      return;

    const moneyLegs = groupLegs.filter(l => l.marketCode === MARKET_MONEYLINE);
    const anchorPool = moneyLegs.length ? moneyLegs : groupLegs;
    const byVenueAnchor = new Map();
    for (const leg of anchorPool) {
      if (!byVenueAnchor.has(leg.venue))
        byVenueAnchor.set(leg.venue, leg);
    }
    const orderedAnchors = [];
    for (const v of VENUE_PRIORITY) {
      if (byVenueAnchor.has(v))
        orderedAnchors.push(byVenueAnchor.get(v));
    }
    for (const [v, leg] of byVenueAnchor) {
      if (!VENUE_PRIORITY.includes(v))
        orderedAnchors.push(leg);
    }
    if (!orderedAnchors.length)
      return;

    if (byVenueAnchor.size > 1)
      multiVenueCount += 1;

    let anchor = orderedAnchors[0];
    if (isFootball) {
      const needTeams = !anchor.home || !anchor.away
        || isFootballOutcomeLabelName(anchor.home)
        || isFootballOutcomeLabelName(anchor.away);
      if (needTeams) {
        const fromTitle = parseFootballTitleTeams(
          groupLegs.map(l => l.matchTitle).find(t => parseFootballTitleTeams(t)) || "",
        );
        if (!fromTitle)
          return;
        anchor = { ...anchor, home: fromTitle.home, away: fromTitle.away };
      }
    }
    const game = isFootball
      ? preferFootballGame(groupLegs, gameCodeForSport(sportKey, anchor.game))
      : gameCodeForSport(sportKey, anchor.game);
    const mergeKey = pairKey
      ? `${sportKey}|${pairKey}`
      : `${sportKey}|solo|${anchor.venue}|${anchor.sourceMatchId}`;
    const id = sportMergedMatchId(sportKey, mergeKey);

    const matchs = {};
    for (const leg of orderedAnchors) {
      matchs[leg.venue] = leg.sourceMatchId;
      linkUpdates.push({
        sport: sportKey,
        venue: leg.venue,
        source_match_id: leg.sourceMatchId,
        match_id: id,
      });
    }
    // 其它盘口场馆 id 也登记
    for (const leg of groupLegs) {
      if (!matchs[leg.venue])
        matchs[leg.venue] = leg.sourceMatchId;
    }

    /** @type {Map<string, object[]>} */
    const byMarket = new Map();
    for (const leg of groupLegs) {
      let line = leg.line;
      const ah = sportTeams.resolveKey(anchor.home, game);
      const ch = sportTeams.resolveKey(leg.home, game);
      const ca = sportTeams.resolveKey(leg.away, game);
      const flipped = Boolean(ah && ca && ah === ca && !(ah && ch && ah === ch));
      if (leg.marketCode === MARKET_SPREADS)
        line = orientSpreadLine(line, flipped);
      const mk = marketBetKey(leg.marketCode, line);
      if (!byMarket.has(mk))
        byMarket.set(mk, []);
      byMarket.get(mk).push({ ...leg, line, _flipped: flipped });
    }

    /** @type {object[]} */
    const bets = [];
    let betSeq = 0;
    for (const [, mLegs] of byMarket) {
      const byVenue = new Map();
      for (const leg of mLegs) {
        if (!byVenue.has(leg.venue))
          byVenue.set(leg.venue, leg);
      }
      const ordered = [];
      for (const v of VENUE_PRIORITY) {
        if (byVenue.has(v))
          ordered.push(byVenue.get(v));
      }
      for (const [v, leg] of byVenue) {
        if (!VENUE_PRIORITY.includes(v))
          ordered.push(leg);
      }
      if (!ordered.length)
        continue;

      const mAnchor = ordered[0];
      const marketCode = mAnchor.marketCode || MARKET_MONEYLINE;
      const line = mAnchor.line;
      const sources = {};
      for (const leg of ordered) {
        let built = buildSourceFromDto(leg, leg.src);
        const oriented = orientSource(
          anchor.home,
          anchor.away,
          leg.home,
          leg.away,
          built,
          game,
          marketCode,
        );
        sources[leg.venue] = oriented.src;
      }

      betSeq += 1;
      const betId = encodeSportBetId(id, betSeq);
      const isTotals = isFootballTotalsMarketCode(marketCode);
      bets.push({
        ID: betId,
        MatchID: id,
        Map: 0,
        Name: displayBetName(marketCode, line),
        MarketCode: marketCode,
        Line: line,
        HomeID: betId * 10 + 11,
        HomeName: isTotals ? "大" : anchor.home,
        AwayID: betId * 10 + 12,
        AwayName: isTotals ? "小" : anchor.away,
        Sources: sources,
      });
    }

    const displayBets = isFootball ? selectFootballDisplayBets(bets) : bets.filter(b =>
      String(b.MarketCode || MARKET_MONEYLINE) === MARKET_MONEYLINE
      || (!b.MarketCode && String(b.Name || "").toLowerCase() === "moneyline")
      || bets.length === 1);

    // 棒球/网球：若过滤后空则保留原 bets 第一条
    const finalBets = displayBets.length
      ? displayBets
      : (bets[0] ? [bets[0]] : []);

    if (!finalBets.length)
      return;

    const startTime = orderedAnchors
      .map(l => Number(l.startTime) || 0)
      .filter(n => n > 0)
      .sort((a, b) => a - b)[0] || Number(anchor.startTime) || 0;
    const title = `${anchor.home} vs ${anchor.away}`;
    const league = groupLegs.map(l => l.league).find(Boolean) || "";

    dtos.push({
      ID: id,
      Title: title,
      Game: game,
      GameID: 0,
      StartTime: startTime,
      ...(league ? { League: league } : {}),
      Matchs: matchs,
      Bets: finalBets,
    });
    dbRows.push({
      id,
      sport: sportKey,
      merge_key: mergeKey,
      title,
      game,
      game_id: null,
      start_time: startTime,
      bo: null,
      round: 0,
      round_start: 0,
      matchs,
      bets: finalBets,
      reverse: [],
      built_at: builtAt,
      home_gb_team_id: null,
      away_gb_team_id: null,
    });
  }

  for (const [pairKey, groupLegs] of groups)
    emitGroup(pairKey, groupLegs);

  dtos.sort((a, b) => (Number(a.StartTime) || 0) - (Number(b.StartTime) || 0));
  return {
    dtos: isFootball ? sanitizeFootballMatchList(dtos) : dtos,
    dbRows,
    linkUpdates,
    multiVenueCount,
  };
}

/**
 * @param {string} sport
 * @param {object[]} list
 */
export async function ingestSportClientMatchDtos(sport, list) {
  const { matches, bets } = clientMatchDtosToSportVenueRows(sport, list);
  if (matches.length)
    await upsertSportVenueMatches(matches);
  if (bets.length)
    await upsertSportVenueBets(bets);

  /** @type {Map<string, Set<string>>} */
  const keepByVenue = new Map();
  for (const m of matches) {
    if (!keepByVenue.has(m.venue))
      keepByVenue.set(m.venue, new Set());
    keepByVenue.get(m.venue).add(m.source_match_id);
  }
  for (const [venue, keep] of keepByVenue) {
    await pruneSportVenueSnapshot(sport, venue, [...keep]);
  }
  return { matchCount: matches.length, betCount: bets.length };
}

/**
 * @param {string} sport
 * @param {object[]} dbRows
 * @param {object[]} linkUpdates
 */
export async function persistSportMergeResult(sport, dbRows, linkUpdates) {
  await replaceSportClientMatches(String(sport), dbRows);
  for (const u of linkUpdates) {
    try {
      await setSportVenueMatchId(u.sport, u.venue, u.source_match_id, u.match_id);
    }
    catch (err) {
      console.warn("[sportMerge] setSportVenueMatchId", err?.message || err);
    }
  }
}

function persistSportInBackground(sport, list, dbRows, linkUpdates) {
  setImmediate(() => {
    void (async () => {
      try {
        await ingestSportClientMatchDtos(sport, list);
        if (dbRows.length)
          await persistSportMergeResult(sport, dbRows, linkUpdates);
      }
      catch (err) {
        console.warn(`[sportMerge] async persist ${sport}`, err?.message || err);
      }
    })();
  });
}

/**
 * API：同步内存合并；落库异步（不阻塞 Get*Matchs）。
 * @param {string} sport
 * @param {object[]} list
 * @returns {Promise<object[]|null>}
 */
export async function ingestAndMergeSportLists(sport, list) {
  const { dtos, dbRows, linkUpdates, multiVenueCount } = mergeSportClientMatchDtoList(sport, list);
  persistSportInBackground(sport, list, dbRows, linkUpdates);
  // 足球：始终返回合场结果。否则 multiVenue=0 时 API 走原始并列，合场侧对「大 vs 小」的修复到不了页面。
  if (String(sport) === "football" && dtos.length)
    return dtos;
  if (multiVenueCount > 0 && dtos.length)
    return dtos;
  return null;
}
