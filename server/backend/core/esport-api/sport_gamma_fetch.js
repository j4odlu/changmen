/**
 * Polymarket Gamma → ClientMatchDto[]（多运动只读列表共用）。
 * 不写电竞 client_matches；不做跨站匹配。
 * 缓存：进程内存 + storage/sport/{key}/（见 sport_list_cache.js）。
 */

import { polymarketGammaMarketAssetIds } from "@changmen/shared/pm_market_assets";
import {
  readFreshSportListCache,
  readSportListCache,
  writeSportListCache,
} from "./sport_list_cache.js";
import {
  MARKET_MONEYLINE,
  MARKET_SPREADS,
  MARKET_TOTALS,
  baseFootballEventTitle,
  cropSportMatchListWindow,
  displayBetName,
  encodeSportBetId,
  isFootballSiblingEventTitle,
  parseMarketLine,
  sportHourBucket,
  sportStartInWindow,
} from "./sport_football_markets.js";

const GAMMA_BASE = process.env.POLYMARKET_GAMMA_BASE || "https://gamma-api.polymarket.com";
const CLOB_BASE = process.env.POLYMARKET_CLOB_BASE || "https://clob.polymarket.com";

const KEYSET_PAGE_LIMIT = 200;
const MAX_KEYSET_PAGES = 8;
const PAST_MS = 24 * 3600 * 1000;
const FUTURE_MS = 7 * 24 * 3600 * 1000;
const CACHE_TTL_MS = 30_000;
/** 冷拉取总预算：裸 fetch 在本机可达 20s+ 才失败，会撑爆前端 15s */
const LIVE_BUDGET_MS = Number(process.env.SPORT_GAMMA_LIVE_BUDGET_MS) || 5_000;

/** @type {Map<string, { at: number, rows: object[] }>} */
const _caches = new Map();
/** @type {Map<string, Promise<object[]>>} */
const _inflight = new Map();

function abortAfter(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  timer.unref?.();
  return controller.signal;
}

function persistSportRows(cacheKey, rows, logTag) {
  const at = Date.now();
  _caches.set(cacheKey, { at, rows });
  try {
    writeSportListCache(cacheKey, rows, at);
  }
  catch (err) {
    console.warn(`[${logTag}] disk write skipped`, err?.message || err);
  }
}

/**
 * @typedef {object} SportGammaOptions
 * @property {string|string[]} sportKey Gamma /sports 的 sport 字段（可多联赛，如 epl+lal）
 * @property {string[]} [tagIds] Gamma 父 tag（足球 100350=Soccer）；设置后按 tag 全量拉取，不走 sportKey/series 白名单
 * @property {string} gameCode ClientMatchDto.Game（如 mlb、soccer）
 * @property {string[]} [defaultSeriesIds] /sports 失败时的 fallback series_id
 * @property {number} [idBase] stableMatchId 基数，与电竞/其他运动错开
 * @property {string} [cacheKey] 进程内缓存键，默认 sportKey
 * @property {string} [logTag]
 * @property {string[]} [leagueGameCodes] 若设，用 event.sport.sport 等覆盖 Game（棒球 mlb|kbo|npb；足球 epl|…）
 * @property {Record<string, string>} [leagueAliases] 可选；馆侧 sport → changmen code（足球专用，棒球勿传）
 * @property {boolean} [lineMarkets] 若 true，挂接 spreads/totals（足球 More Markets）
 * @property {number} [pastMs] 开赛后保留窗，默认 24h（足球传 4h）
 * @property {number} [futureMs] 未开赛保留窗，默认 7 天（足球传 6h）
 * @property {boolean} [preferUpcoming] 若 true，先拉 now→future，再补 past→now，避免早盘被历史分页挡住
 * @property {number} [liveBudgetMs] 单项冷拉取预算；默认 SPORT_GAMMA_LIVE_BUDGET_MS 或 5s
 */

function parseJsonArray(value) {
  if (Array.isArray(value))
    return value.map(String).filter(Boolean);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed)
      return [];
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
    }
    catch {
      return [];
    }
  }
  return [];
}

function decimalOddsFromProbability(price) {
  const value = Number(price);
  if (!Number.isFinite(value) || value <= 0 || value >= 1)
    return 0;
  return Math.round((1 / value) * 1000) / 1000;
}

function startTimeMsOf(event) {
  const raw = event.startTime ?? event.startDate;
  if (raw === undefined || raw === null || raw === "")
    return Date.now();
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0)
    return numeric > 1e12 ? numeric : numeric * 1000;
  const parsed = Date.parse(String(raw));
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function marketTypeOf(market) {
  return String(market.sportsMarketType ?? market.sports_market_type ?? "").toLowerCase();
}

/** Gamma event 的原生联赛名（series[0].title，如 "K-league"）；无则空串 */
function leagueNameOf(raw) {
  const series = Array.isArray(raw?.series) ? raw.series : [];
  for (const row of series) {
    const title = String(row?.title ?? row?.name ?? "").trim();
    if (title)
      return title;
  }
  return "";
}

function isOpenMarket(market) {
  if (market.active === false)
    return false;
  if (market.closed)
    return false;
  if (market.accepting_orders === false || market.acceptingOrders === false)
    return false;
  return true;
}

function conditionIdOf(market) {
  return String(
    market.conditionId
    ?? market.condition_id
    ?? market.conditionID
    ?? market.clobConditionId
    ?? market.clob_condition_id
    ?? market.id
    ?? "",
  ).trim();
}

function unwrapEvents(data) {
  if (Array.isArray(data))
    return data;
  if (Array.isArray(data?.data))
    return data.data;
  if (Array.isArray(data?.events))
    return data.events;
  return [];
}

function nextCursor(data) {
  if (!data || typeof data !== "object")
    return "";
  return String(data.next_cursor ?? data.nextCursor ?? "");
}

async function gammaGet(path, signal) {
  const response = await fetch(`${GAMMA_BASE}${path}`, signal ? { signal } : {});
  if (!response.ok)
    throw new Error(`Gamma ${response.status}: ${path}`);
  return response.json();
}

/**
 * @param {string[]} sportKeys
 * @param {string[]} defaultSeriesIds
 * @param {string} logTag
 * @param {AbortSignal} [signal]
 */
async function fetchSeriesIds(sportKeys, defaultSeriesIds, logTag, signal) {
  const want = new Set(sportKeys.map(k => k.toLowerCase()).filter(Boolean));
  if (!want.size)
    return defaultSeriesIds.length ? defaultSeriesIds : [];
  try {
    const sports = await gammaGet("/sports", signal);
    const ids = (Array.isArray(sports) ? sports : [])
      .filter(row => want.has(String(row.sport ?? "").toLowerCase()))
      .map(row => String(row.series ?? "").trim())
      .filter(Boolean);
    if (ids.length)
      return [...new Set(ids)];
  }
  catch (err) {
    if (signal?.aborted)
      throw err;
    console.warn(`[${logTag}] /sports fallback`, err?.message || err);
  }
  return defaultSeriesIds.length ? defaultSeriesIds : [];
}

async function fetchBatchBuyPrices(assetIds, signal) {
  if (!assetIds.length)
    return {};
  const body = assetIds.map(token_id => ({ token_id, side: "SELL" }));
  let response;
  try {
    response = await fetch(`${CLOB_BASE}/prices`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
  }
  catch {
    return {};
  }
  if (!response.ok)
    return {};
  const data = await response.json();
  const result = {};
  for (const [tokenId, sides] of Object.entries(data ?? {})) {
    const price = Number(sides?.SELL ?? 0);
    if (price > 0 && price < 1)
      result[tokenId] = price;
  }
  return result;
}

/**
 * @param {string} key
 * @param {number} idBase
 */
function stableMatchId(key, idBase) {
  let h = 0;
  const s = String(key);
  for (let i = 0; i < s.length; i += 1)
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  const n = Math.abs(h) || 1;
  return idBase + (n % 99_000_000);
}

function splitTitleTeams(title) {
  let text = String(title || "").trim();
  // 去掉联赛前缀，避免 HomeName 变成 "KBO: NC Dinos"
  text = text.replace(/^(kbo|npb|mlb)(?:\s+playoffs?)?\s*:\s*/i, "");
  // 足球：标题里偶发 "Team (-1.5) vs Team (-1.5)"
  text = text.replace(/\s*\([+-]?\d+(?:\.\d+)?\)\s*/g, " ").replace(/\s+/g, " ").trim();
  const parts = text.split(/\s+vs\.?\s+/i);
  if (parts.length >= 2)
    return { home: parts[0].trim(), away: parts.slice(1).join(" vs ").trim() };
  const at = text.split(/\s+@\s+/);
  if (at.length === 2)
    return { home: at[1].trim(), away: at[0].trim() };
  return { home: text || "Home", away: "Away" };
}

/**
 * 棒球等多联赛：用 Gamma event.sport.sport / seriesSlug 作为 Game（mlb|kbo|npb）。
 * @param {object} raw
 * @param {string} fallbackGame
 * @param {string[]} [leagueGameCodes]
 * @param {Record<string, string>} [leagueAliases] 馆侧 sport → changmen code（仅调用方传入时生效；足球 col→uecl）
 */
function resolveEventGameCode(raw, fallbackGame, leagueGameCodes, leagueAliases) {
  const allow = new Set((leagueGameCodes || []).map(k => String(k).toLowerCase()).filter(Boolean));
  if (!allow.size)
    return fallbackGame;
  /** @type {Record<string, string>} */
  const aliases = leagueAliases && typeof leagueAliases === "object" ? leagueAliases : {};
  const mapKey = (key) => {
    const k = String(key || "").toLowerCase().trim();
    if (!k)
      return null;
    if (allow.has(k))
      return k;
    const mapped = String(aliases[k] || "").toLowerCase().trim();
    if (mapped && allow.has(mapped))
      return mapped;
    return null;
  };
  const fromSport = mapKey(raw?.sport?.sport);
  if (fromSport)
    return fromSport;
  const fromSlug = mapKey(raw?.seriesSlug);
  if (fromSlug)
    return fromSlug;
  const series = Array.isArray(raw?.series) ? raw.series : [];
  for (const row of series) {
    const hit = mapKey(row?.ticker ?? row?.slug);
    if (hit)
      return hit;
  }
  return fallbackGame;
}

function resolveListWindow(options) {
  const pastMs = Number(options?.pastMs);
  const futureMs = Number(options?.futureMs);
  return {
    pastMs: Number.isFinite(pastMs) && pastMs >= 0 ? pastMs : PAST_MS,
    futureMs: Number.isFinite(futureMs) && futureMs > 0 ? futureMs : FUTURE_MS,
  };
}

/**
 * @param {SportGammaOptions} options
 * @param {{ forceRefresh?: boolean }} [runtime]
 * @returns {Promise<object[]>} ClientMatchDto[]
 */
export async function fetchSportAsClientMatchDtos(options, runtime = {}) {
  const sportKeys = (
    Array.isArray(options.sportKey) ? options.sportKey : [options.sportKey]
  )
    .map(k => String(k || "").toLowerCase())
    .filter(Boolean);
  const tagIds = (Array.isArray(options.tagIds) ? options.tagIds : [])
    .map(String).filter(Boolean);
  const gameCode = String(options.gameCode || sportKeys[0] || "sport");
  const defaultSeriesIds = (options.defaultSeriesIds || []).map(String).filter(Boolean);
  const idBase = Number(options.idBase) || 900_000_000;
  const cacheKey = String(options.cacheKey || sportKeys.join("+") || "sport");
  const logTag = String(options.logTag || `sportGamma:${cacheKey}`);
  const leagueGameCodes = Array.isArray(options.leagueGameCodes)
    ? options.leagueGameCodes.map(k => String(k || "").toLowerCase()).filter(Boolean)
    : [];
  const leagueAliases = options.leagueAliases && typeof options.leagueAliases === "object"
    ? options.leagueAliases
    : undefined;
  const lineMarkets = Boolean(options.lineMarkets);
  const { pastMs, futureMs } = resolveListWindow(options);
  const crop = rows => cropSportMatchListWindow(rows, pastMs, futureMs);
  const forceRefresh = runtime.forceRefresh === true;

  const mem = _caches.get(cacheKey);
  if (!forceRefresh && mem && Date.now() - mem.at < CACHE_TTL_MS)
    return crop(mem.rows);

  const diskFresh = forceRefresh ? null : readFreshSportListCache(cacheKey);
  if (diskFresh) {
    _caches.set(cacheKey, { at: diskFresh.at, rows: diskFresh.rows });
    return crop(diskFresh.rows);
  }

  let live = _inflight.get(cacheKey);
  if (!live) {
    const optionBudgetMs = Number(options.liveBudgetMs);
    const signal = abortAfter(Number.isFinite(optionBudgetMs) && optionBudgetMs > 0 ? optionBudgetMs : LIVE_BUDGET_MS);
    const args = {
      sportKeys,
      tagIds,
      gameCode,
      defaultSeriesIds,
      idBase,
      logTag,
      leagueGameCodes,
      leagueAliases,
      lineMarkets,
      pastMs,
      futureMs,
      preferUpcoming: Boolean(options.preferUpcoming),
      signal,
    };
    live = (async () => {
      const rows = crop(await fetchSportRowsFromGamma(args));
      persistSportRows(cacheKey, rows, logTag);
      return rows;
    })()
      .catch((err) => {
        if (forceRefresh) throw err;
        const diskAny = readSportListCache(cacheKey);
        if (diskAny?.rows?.length) {
          console.warn(`[${logTag}] gamma failed, serving stale disk cache`, err?.message || err);
          _caches.set(cacheKey, { at: diskAny.at, rows: diskAny.rows });
          return crop(diskAny.rows);
        }
        throw err;
      })
      .finally(() => {
        if (_inflight.get(cacheKey) === live)
          _inflight.delete(cacheKey);
      });
    _inflight.set(cacheKey, live);
  }

  const stale = readSportListCache(cacheKey);
  const staleRows = stale?.rows?.length ? crop(stale.rows) : [];
  if (!forceRefresh && staleRows.length) {
    live.catch((err) => {
      console.warn(`[${logTag}] background refresh failed`, err?.message || err);
    });
    return staleRows;
  }
  return live;
}

/**
 * @param {{ sportKeys: string[], tagIds?: string[], gameCode: string, defaultSeriesIds: string[], idBase: number, logTag: string, leagueGameCodes?: string[], leagueAliases?: Record<string, string>, lineMarkets?: boolean, pastMs: number, futureMs: number, preferUpcoming?: boolean, signal?: AbortSignal }} opts
 */
async function fetchSportRowsFromGamma(opts) {
  const { sportKeys, tagIds = [], gameCode, defaultSeriesIds, idBase, logTag, leagueGameCodes, leagueAliases, lineMarkets, pastMs, futureMs, preferUpcoming, signal } = opts;

  let seriesIds = [];
  if (!tagIds.length) {
    seriesIds = await fetchSeriesIds(sportKeys, defaultSeriesIds, logTag, signal);
    if (!seriesIds.length) {
      throw new Error(
        `[${logTag}] 无可用 Gamma series（sportKey=${sportKeys.join(",") || "?"}；请检查 /sports 或 defaultSeriesIds）`,
      );
    }
  }

  const now = Date.now();
  /** @type {object[]} */
  const collected = [];
  const seenRawIds = new Set();
  const ranges = preferUpcoming
    ? [
        { min: now, max: now + futureMs },
        ...(pastMs > 0 ? [{ min: now - pastMs, max: now }] : []),
      ]
    : [{ min: now - pastMs, max: now + futureMs }];

  rangeLoop:
  for (const range of ranges) {
    let cursor = "";
    for (let page = 0; page < MAX_KEYSET_PAGES; page += 1) {
      const params = new URLSearchParams({
        closed: "false",
        limit: String(KEYSET_PAGE_LIMIT),
        order: "startTime",
        ascending: "true",
        start_time_min: new Date(range.min).toISOString(),
        start_time_max: new Date(range.max).toISOString(),
      });
      for (const id of tagIds)
        params.append("tag_id", id);
      for (const id of seriesIds)
        params.append("series_id", id);
      if (cursor)
        params.set("after_cursor", cursor);

      let data;
      try {
        data = await gammaGet(`/events/keyset?${params.toString()}`, signal);
      }
      catch (err) {
        if (signal?.aborted && collected.length) {
          console.warn(`[${logTag}] gamma stopped after partial rows`, err?.message || err);
          break rangeLoop;
        }
        throw err;
      }
      for (const raw of unwrapEvents(data)) {
        const rawKey = String(raw.id ?? raw.slug ?? raw.title ?? "");
        if (rawKey && seenRawIds.has(rawKey))
          continue;
        if (rawKey)
          seenRawIds.add(rawKey);

        const title = String(raw.title ?? "").trim();
        if (!title)
          continue;
        const sibling = isFootballSiblingEventTitle(title);
        if (!sibling && /\b(halftime|half[\s-]?time|1st half|2nd half|second half|map\s*\d|period\s*\d)\b/i.test(title))
          continue;

        const openMarkets = (raw.markets ?? []).filter(isOpenMarket);
        /** @type {object[]} */
        const typed = [];
        for (const market of openMarkets) {
          const t = marketTypeOf(market);
          if (t !== MARKET_MONEYLINE && !(lineMarkets && (t === MARKET_SPREADS || t === MARKET_TOTALS)))
            continue;
          const outcomes = parseJsonArray(market.outcomes);
          const prices = parseJsonArray(market.outcomePrices ?? market.outcome_prices);
          const tokenIds = polymarketGammaMarketAssetIds(market);
          if (!tokenIds.length)
            continue;
          if (outcomes.length < 2)
            continue;
          // moneyline 可无无 CLOB token（靠 outcomePrices）；spreads/totals 至少要有双边 outcome
          if ((t === MARKET_SPREADS || t === MARKET_TOTALS) && tokenIds.length < 2 && prices.length < 2)
            continue;
          const line = t === MARKET_MONEYLINE
            ? null
            : parseMarketLine(market.line ?? market.spread ?? market.groupItemTitle ?? market.question);
          if ((t === MARKET_SPREADS || t === MARKET_TOTALS) && line == null)
            continue;
          typed.push({
            conditionId: conditionIdOf(market),
            marketCode: t,
            line,
            outcomes,
            prices,
            tokenIds,
            question: String(market.question || market.groupItemTitle || ""),
            groupItemTitle: String(market.groupItemTitle || ""),
          });
        }
        if (!typed.length)
          continue;

        const startTimeMs = startTimeMsOf(raw);
        if (!sportStartInWindow(startTimeMs, pastMs, futureMs, now))
          continue;

        collected.push({
          id: String(raw.id ?? raw.slug ?? title),
          title,
          base: baseFootballEventTitle(title),
          startTimeMs,
          game: resolveEventGameCode(raw, gameCode, leagueGameCodes, leagueAliases),
          markets: typed,
          sibling,
          league: leagueNameOf(raw),
        });
      }
      cursor = nextCursor(data);
      if (!cursor)
        break;
    }
  }

  /** @type {Map<string, object>} */
  const groups = new Map();
  for (const ev of collected) {
    const hourBucket = sportHourBucket(ev.startTimeMs);
    const key = `${ev.game}|${String(ev.base).toLowerCase()}|${hourBucket}`;
    if (!groups.has(key)) {
      groups.set(key, {
        game: ev.game,
        base: ev.base,
        startTimeMs: ev.startTimeMs,
        mainId: null,
        mainTitle: ev.base,
        league: ev.league || "",
        markets: /** @type {object[]} */ ([]),
      });
    }
    const g = groups.get(key);
    if (!g.league && ev.league)
      g.league = ev.league;
    if (!ev.sibling && ev.markets.some(m => m.marketCode === MARKET_MONEYLINE)) {
      g.mainId = ev.id;
      g.mainTitle = ev.base;
      g.startTimeMs = ev.startTimeMs || g.startTimeMs;
    }
    else if (!g.mainId && !ev.sibling) {
      g.mainId = ev.id;
      g.mainTitle = ev.base;
    }
    if (ev.startTimeMs && (!g.startTimeMs || ev.startTimeMs < g.startTimeMs))
      g.startTimeMs = ev.startTimeMs;
    for (const m of ev.markets)
      g.markets.push(m);
  }

  /** @type {object[]} */
  const events = [];
  for (const g of groups.values()) {
    const hasMl = g.markets.some(m => m.marketCode === MARKET_MONEYLINE);
    if (!hasMl)
      continue;
    if (!g.mainId)
      g.mainId = `${g.game}:${g.base}`;
    events.push(g);
  }
  events.sort((a, b) => a.startTimeMs - b.startTimeMs);

  const tokenIds = [];
  for (const ev of events) {
    for (const m of ev.markets) {
      for (const tid of m.tokenIds) {
        if (tid)
          tokenIds.push(tid);
      }
    }
  }
  const livePrices = tokenIds.length
    ? await fetchBatchBuyPrices([...new Set(tokenIds)].slice(0, 400), signal)
    : {};

  return events.map((ev) => {
    const { home, away } = splitTitleTeams(ev.mainTitle || ev.base);
    const matchId = stableMatchId(ev.mainId, idBase);
    /** @type {object[]} */
    const bets = [];
    let betSeq = 0;

    const moneyline = ev.markets.find(m => m.marketCode === MARKET_MONEYLINE);
    if (moneyline) {
      betSeq += 1;
      const oriented = orientBinaryOutcomes(moneyline, home, away, livePrices, "team");
      bets.push(buildSportBetRow({
        matchId,
        betSeq,
        marketCode: MARKET_MONEYLINE,
        line: null,
        homeName: home,
        awayName: away,
        homeOdds: oriented.homeOdds,
        awayOdds: oriented.awayOdds,
        homeToken: oriented.homeToken,
        awayToken: oriented.awayToken,
        sourceMatchId: ev.mainId,
        sourceBetId: moneyline.conditionId,
      }));
    }

    if (lineMarkets) {
      /** @type {Map<number, object>} */
      const spreadsByLine = new Map();
      for (const m of ev.markets) {
        if (m.marketCode !== MARKET_SPREADS || m.line == null)
          continue;
        const homeRel = homeRelativeSpreadLine(m, home, away);
        if (homeRel == null || spreadsByLine.has(homeRel))
          continue;
        const oriented = orientBinaryOutcomes(m, home, away, livePrices, "team");
        spreadsByLine.set(homeRel, { m, oriented, homeRel });
      }
      for (const { m, oriented, homeRel } of spreadsByLine.values()) {
        betSeq += 1;
        bets.push(buildSportBetRow({
          matchId,
          betSeq,
          marketCode: MARKET_SPREADS,
          line: homeRel,
          homeName: home,
          awayName: away,
          homeOdds: oriented.homeOdds,
          awayOdds: oriented.awayOdds,
          homeToken: oriented.homeToken,
          awayToken: oriented.awayToken,
          sourceMatchId: ev.mainId,
          sourceBetId: m.conditionId,
        }));
      }

      /** @type {Map<number, object>} */
      const totalsByLine = new Map();
      for (const m of ev.markets) {
        if (m.marketCode !== MARKET_TOTALS || m.line == null)
          continue;
        const line = Number(m.line);
        if (!Number.isFinite(line) || totalsByLine.has(line))
          continue;
        const oriented = orientBinaryOutcomes(m, "Over", "Under", livePrices, "ou");
        totalsByLine.set(line, { m, oriented, line });
      }
      for (const { m, oriented, line } of totalsByLine.values()) {
        betSeq += 1;
        bets.push(buildSportBetRow({
          matchId,
          betSeq,
          marketCode: MARKET_TOTALS,
          line,
          homeName: "大",
          awayName: "小",
          homeOdds: oriented.homeOdds,
          awayOdds: oriented.awayOdds,
          homeToken: oriented.homeToken,
          awayToken: oriented.awayToken,
          sourceMatchId: ev.mainId,
          sourceBetId: m.conditionId,
        }));
      }
    }

    if (!bets.length)
      return null;

    return {
      ID: matchId,
      Title: ev.mainTitle || ev.base,
      Game: ev.game || gameCode,
      GameID: 0,
      StartTime: ev.startTimeMs,
      ...(ev.league ? { League: ev.league } : {}),
      Matchs: {
        Polymarket: ev.mainId,
      },
      Bets: bets,
    };
  }).filter(Boolean);
}

/**
 * @param {object} market
 * @param {string} homeLabel
 * @param {string} awayLabel
 * @param {Record<string, number>} livePrices
 * @param {"team"|"ou"} mode
 */
function orientBinaryOutcomes(market, homeLabel, awayLabel, livePrices, mode) {
  const o0 = String(market.outcomes[0] ?? "");
  const o1 = String(market.outcomes[1] ?? "");
  const p0 = livePrices[market.tokenIds[0]] ?? Number(market.prices[0] ?? 0);
  const p1 = livePrices[market.tokenIds[1]] ?? Number(market.prices[1] ?? 0);
  let homeIdx = 0;
  if (mode === "ou") {
    const l0 = o0.toLowerCase();
    const l1 = o1.toLowerCase();
    if (l0.startsWith("under") || l0 === "u")
      homeIdx = 1;
    else if (l1.startsWith("over") || l1 === "o")
      homeIdx = 1;
    else
      homeIdx = 0;
  }
  else {
    const homeL = String(homeLabel).toLowerCase();
    const awayL = String(awayLabel).toLowerCase();
    const l0 = o0.toLowerCase();
    const l1 = o1.toLowerCase();
    if (homeL && (l1.includes(homeL) || homeL.includes(l1) || homeL.includes(l1.split(" ").pop() || "___")))
      homeIdx = 1;
    else if (awayL && (l0.includes(awayL) || awayL.includes(l0)))
      homeIdx = 1;
    else
      homeIdx = 0;
  }
  const awayIdx = homeIdx === 0 ? 1 : 0;
  return {
    homeOdds: decimalOddsFromProbability(homeIdx === 0 ? p0 : p1),
    awayOdds: decimalOddsFromProbability(awayIdx === 0 ? p0 : p1),
    homeToken: market.tokenIds[homeIdx] || "",
    awayToken: market.tokenIds[awayIdx] || "",
  };
}

/**
 * 将 PM spread 线转成相对主队（标题主队）。
 * outcomes[0] / groupItemTitle 为让球方队名。
 * @param {object} market
 * @param {string} home
 * @param {string} away
 */
function homeRelativeSpreadLine(market, home, away) {
  const line = Number(market.line);
  if (!Number.isFinite(line))
    return null;
  const o0 = String(market.outcomes[0] ?? "").toLowerCase();
  const group = String(market.groupItemTitle || market.question || "").toLowerCase();
  const homeL = home.toLowerCase();
  const awayL = away.toLowerCase();
  const matches = (label, text) => {
    if (!label || !text)
      return false;
    if (text.includes(label) || label.includes(text))
      return true;
    const last = label.split(/\s+/).pop() || "";
    return last.length > 2 && text.includes(last);
  };
  if (matches(homeL, o0) || matches(homeL, group))
    return line;
  if (matches(awayL, o0) || matches(awayL, group))
    return -line;
  return line;
}

/**
 * @param {object} p
 */
function buildSportBetRow(p) {
  const betId = encodeSportBetId(p.matchId, p.betSeq);
  return {
    ID: betId,
    MatchID: p.matchId,
    Map: 0,
    Name: displayBetName(p.marketCode, p.line),
    MarketCode: p.marketCode,
    Line: p.line,
    HomeID: betId * 10 + 1,
    HomeName: p.homeName,
    AwayID: betId * 10 + 2,
    AwayName: p.awayName,
    Sources: {
      Polymarket: {
        Type: "Polymarket",
        BetID: p.sourceBetId || String(p.sourceMatchId),
        HomeID: p.homeToken || `${p.sourceMatchId}-home`,
        AwayID: p.awayToken || `${p.sourceMatchId}-away`,
        HomeOdds: p.homeOdds,
        AwayOdds: p.awayOdds,
        Status: "Normal",
      },
    },
  };
}

/** @param {string} [cacheKey] */
export function clearSportGammaCache(cacheKey) {
  if (cacheKey) {
    _caches.delete(cacheKey);
    _inflight.delete(cacheKey);
    return;
  }
  _caches.clear();
  _inflight.clear();
}
