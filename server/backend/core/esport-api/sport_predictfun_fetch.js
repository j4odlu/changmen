/**
 * Predict.fun REST → ClientMatchDto[]（棒球/足球/网球只读）。
 * 本模块只产出单馆 DTO；与 PM 的跨馆合并在 `sport_merge`（对不上则 API fallback 并列）。
 * 不写电竞 client_matches / platform_*；不做电竞 matcher；不开 sport 下注。
 *
 * 官方形态（dev.predict.fun MarketVariant / Get categories）：
 * - 棒球常为 SPORTS_TEAM_MATCH：单盘 SPORTS_MONEYLINE + 双 outcome（各含 team）
 * - 足球常为 SPORTS_MATCH：主/客/(平) 多盘；status 多为 REGISTERED + tradingStatus OPEN
 * - 网球（球员对阵）为 SPORTS_TEAM_MATCH + tag Tennis(`85`)；当前 OPEN 多为 futures（DEFAULT），moneyline 常为空
 * 本机 Windows 往往直连 api.predict.fun TLS 失败 → 经 HK http-relay 出海。
 *
 * 缓存：storage/sport/{mlb_pf,soccer_pf,tennis_pf}/（见 sport_list_cache.js）。
 */

import {
  readFreshSportListCache,
  readSportListCache,
  writeSportListCache,
} from "./sport_list_cache.js";
import {
  FOOTBALL_FALLBACK_GAMES,
  FOOTBALL_LEAGUE_CODES,
  FOOTBALL_LIST_FUTURE_MS,
  MARKET_MONEYLINE,
  MARKET_SPREADS,
  MARKET_TOTALS,
  UNKNOWN_FOOTBALL_GAME,
  baseFootballEventTitle,
  cropSportMatchListWindow,
  displayBetName,
  encodeSportBetId,
  isFootballSiblingEventTitle,
  parseLineFromTitle,
  resolveFootballLeagueFromText,
  sportStartInWindow,
  stripFootballHandicapSuffix,
} from "./sport_football_markets.js";

const PREDICT_FUN_API = String(
  process.env.PREDICT_FUN_API_BASE || "https://api.predict.fun",
).replace(/\/$/, "");

const PAGE_SIZE = 50;
const MAX_PAGES = 5;
const PAST_MS = 24 * 3600 * 1000;
const FUTURE_MS = 7 * 24 * 3600 * 1000;
const CACHE_TTL_MS = 30_000;
const MAX_TRACKED = 200;
const ORDERBOOK_CONCURRENCY = 8;
/** 直连 predict.fun 单次上限；超时再走 HK relay，避免裸 fetch 挂死 */
const DIRECT_TIMEOUT_MS = Number(process.env.SPORT_PF_DIRECT_TIMEOUT_MS) || 4_000;
/** 冷拉取总预算（无过期磁盘时才等待） */
const LIVE_BUDGET_MS = Number(process.env.SPORT_PF_LIVE_BUDGET_MS) || 8_000;
export const PREDICT_FUN_FOOTBALL_PAST_MS = 0;

/** 官方 /v1/tags（联调快照）；失败时仍靠 name 过滤 */
const TAG_MLB = "142";
const TAG_BASEBALL = "143";
const TAG_SOCCER = "14";
const TAG_TENNIS = "85";

/** @type {Map<string, { at: number, rows: object[] }>} */
const _caches = new Map();
/** @type {Map<string, Promise<object[]>>} */
const _inflight = new Map();

/** @type {{ token: string, expMs: number } | null} */
let _relayTokenCache = null;

const ESPORT_RE = /\b(cs2|counter[- ]?strike|lol|league[- ]?of[- ]?legends|dota-?2|valorant|esport|esports|lck|lpl|lec|lcs|vct|blast|iem|esl)\b/i;
const NFL_RE = /\b(nfl|american football|ncaa football|cfb|ncaaf)\b/i;

function abortAfter(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  timer.unref?.();
  return controller.signal;
}

function mergeAbort(signal, timeoutMs) {
  const local = abortAfter(timeoutMs);
  if (!signal)
    return local;
  if (typeof AbortSignal.any === "function")
    return AbortSignal.any([signal, local]);
  return local;
}

function persistPredictRows(cacheKey, rows, logTag) {
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
 * @param {string|undefined} name
 * @returns {"mlb"|"soccer"|"tennis"|"nba"|null}
 */
export function mapPredictSportTag(name) {
  const raw = String(name ?? "").trim().toLowerCase();
  if (!raw || ESPORT_RE.test(raw) || NFL_RE.test(raw))
    return null;
  if (/\b(mlb|major league baseball|baseball|kbo|korea baseball|npb|nippon professional baseball)\b/.test(raw)
    || raw === "mlb"
    || raw === "kbo"
    || raw === "npb")
    return "mlb";
  if (/\b(nba|national basketball|basketball)\b/.test(raw) || raw === "nba")
    return "nba";
  if (/\b(tennis|atp|wta|roland[- ]?garros|wimbledon|us open|australian open)\b/.test(raw) || raw === "tennis")
    return "tennis";
  // 「Football」单独不做映射（美式/欧式均用）；需 Soccer / 联赛码
  if (
    /\b(soccer|epl|premier league|la liga|laliga|bundesliga|serie a|ligue 1|mls|ucl|uel|champions league|europa league|fifa|uefa|copa|eredivisie|liga mx|brasileir[aã]o|primera|world cup)\b/.test(raw)
    || raw === "soccer"
  ) {
    return "soccer";
  }
  return null;
}

/**
 * @param {object} category
 * @returns {"mlb"|"soccer"|"tennis"|"nba"|null}
 */
export function resolveSportGameCodeFromCategory(category) {
  const tagNames = (category.tags ?? []).map(t => String(t.name ?? "").trim()).filter(Boolean);
  const lower = new Set(tagNames.map(n => n.toLowerCase()));
  if (lower.has("mlb") || lower.has("baseball") || lower.has("kbo") || lower.has("npb"))
    return "mlb";
  if (lower.has("nba") || lower.has("basketball"))
    return "nba";
  if (lower.has("tennis") || lower.has("atp") || lower.has("wta"))
    return "tennis";
  if (lower.has("soccer") || lower.has("world cup"))
    return "soccer";
  if (lower.has("football") && !lower.has("nfl") && !NFL_RE.test([...lower].join(" "))) {
    // Football + 欧战/联赛码常见于 Soccer 盘；仅 football 则再看 league
    for (const team of category.teams ?? []) {
      const code = mapPredictSportTag(team.league);
      if (code)
        return code;
    }
  }
  for (const name of tagNames) {
    const code = mapPredictSportTag(name);
    if (code)
      return code;
  }
  for (const team of category.teams ?? []) {
    const code = mapPredictSportTag(team.league);
    if (code)
      return code;
  }
  return null;
}

function resolvePredictFunApiKey() {
  return String(
    process.env.PREDICT_FUN_API_KEY
    || process.env.VITE_PREDICT_FUN_API_KEY
    || "",
  ).trim();
}

function resolveHttpRelayOrigin() {
  return String(
    process.env.PREDICT_FUN_HTTP_RELAY_ORIGIN
    || process.env.HK_RELAY_ORIGIN
    || process.env.VITE_HK_RELAY_ORIGIN
    || process.env.VITE_PM_HK_RELAY_ORIGIN
    || "",
  ).trim().replace(/\/+$/, "");
}

async function resolveRelayAuthToken() {
  const fromEnv = String(
    process.env.PROBE_TOKEN
    || process.env.ESPORT_TEST_TOKEN
    || process.env.PREDICT_FUN_HTTP_RELAY_TOKEN
    || "",
  ).trim();
  if (fromEnv)
    return fromEnv;

  const now = Date.now();
  if (_relayTokenCache && _relayTokenCache.expMs > now + 60_000)
    return _relayTokenCache.token;

  const secret = String(process.env.JWT_SECRET || "").trim();
  if (secret.length < 16)
    return "";

  try {
    const { findSportRelayUserId } = await import("@changmen/db/relay_identity.js");
    const userId = await findSportRelayUserId();
    if (!userId)
      return "";
    const { signJwt, JWT_ACCESS_TTL_SEC } = await import("@changmen/db/jwt.js");
    const ttl = Math.min(Number(JWT_ACCESS_TTL_SEC) || 3600, 3600);
    const token = signJwt(
      { sub: userId, typ: "access", session_id: "sport-predictfun-fetch" },
      secret,
      ttl,
    );
    _relayTokenCache = { token, expMs: now + ttl * 1000 };
    return token;
  }
  catch (err) {
    console.warn("[sportPf] relay JWT skipped", err?.message || err);
    return "";
  }
}

async function predictHttpGetDirect(url, signal) {
  const headers = { Accept: "application/json" };
  const apiKey = resolvePredictFunApiKey();
  if (apiKey)
    headers["x-api-key"] = apiKey;
  const res = await fetch(url, { headers, signal: mergeAbort(signal, DIRECT_TIMEOUT_MS) });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text.trim() || `HTTP ${res.status}`);
  }
  return res.json();
}

async function predictHttpGetViaRelay(url, signal) {
  const origin = resolveHttpRelayOrigin();
  if (!origin)
    throw new Error("PREDICT_FUN_HTTP_RELAY_ORIGIN / HK_RELAY_ORIGIN 未配置");
  const token = await resolveRelayAuthToken();
  if (!token)
    throw new Error("http-relay 需要 PROBE_TOKEN 或可签发 JWT（JWT_SECRET + RDS）");

  const headers = {
    Accept: "application/json",
    token,
    "x-proxy-url": url,
    "x-proxy-referer": "https://predict.fun/",
    "x-proxy-origin": "https://predict.fun",
  };
  const apiKey = resolvePredictFunApiKey();
  if (apiKey)
    headers["x-api-key"] = apiKey;

  const res = await fetch(`${origin}/esport/http-relay`, {
    method: "GET",
    headers,
    ...(signal ? { signal } : {}),
  });
  const text = await res.text();
  if (!res.ok)
    throw new Error(text.trim() || `relay HTTP ${res.status}`);
  return JSON.parse(text);
}

/** @type {boolean | null} null=unknown, false=use relay, true=direct ok */
let _directOk = null;

/**
 * 直连优先；TLS/网络失败则走 HK http-relay（会话内记住，避免每个 orderbook 都先撞墙）。
 * @param {string} url
 * @param {AbortSignal} [signal]
 */
async function predictHttpGet(url, signal) {
  if (_directOk === false)
    return predictHttpGetViaRelay(url, signal);

  if (_directOk === true) {
    try {
      return await predictHttpGetDirect(url, signal);
    }
    catch (err) {
      if (signal?.aborted)
        throw err;
      _directOk = false;
      console.warn("[sportPf] predict.fun direct broke, switch to http-relay", err?.message || err);
      return predictHttpGetViaRelay(url, signal);
    }
  }

  try {
    const data = await predictHttpGetDirect(url, signal);
    _directOk = true;
    return data;
  }
  catch (err) {
    if (signal?.aborted)
      throw err;
    if (!resolveHttpRelayOrigin())
      throw err;
    _directOk = false;
    console.warn("[sportPf] direct predict.fun failed, using http-relay", err?.message || err);
    return predictHttpGetViaRelay(url, signal);
  }
}

function variantsForGame(gameCode) {
  if (gameCode === "mlb" || gameCode === "tennis" || gameCode === "nba")
    return ["SPORTS_TEAM_MATCH"];
  // soccer：胜负 SPORTS_MATCH；让球/大小在 SPORTS_PROPS（- More Markets）
  return [
    "SPORTS_MATCH",
    "SPORTS_TEAM_MATCH",
    "SPORTS_FIFA_WORLD_CUP",
    "SPORTS_FIFA_FRIENDLIES",
    "SPORTS_PROPS",
  ];
}

function tagIdsForGame(gameCode) {
  if (gameCode === "mlb")
    return `${TAG_MLB},${TAG_BASEBALL}`;
  if (gameCode === "soccer")
    return TAG_SOCCER;
  if (gameCode === "tennis")
    return TAG_TENNIS;
  if (gameCode === "nba")
    return "";
  return "";
}

async function fetchPredictCategoriesForGame(gameCode, signal) {
  const byId = new Map();
  for (const marketVariant of variantsForGame(gameCode)) {
    if (signal?.aborted)
      throw signal.reason || new Error("predict.fun category fetch aborted");
    let after;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const qs = new URLSearchParams({
        first: String(PAGE_SIZE),
        status: "OPEN",
        marketVariant,
      });
      const tagIds = tagIdsForGame(gameCode);
      if (tagIds)
        qs.set("tagIds", tagIds);
      if (after)
        qs.set("after", after);
      const res = await predictHttpGet(`${PREDICT_FUN_API}/v1/categories?${qs.toString()}`, signal);
      const batch = Array.isArray(res?.data) ? res.data : [];
      for (const row of batch) {
        const id = String(row?.id ?? row?.slug ?? "");
        if (id && !byId.has(id))
          byId.set(id, row);
      }
      after = res?.cursor ? String(res.cursor) : undefined;
      if (!after || !batch.length)
        break;
    }
  }
  return [...byId.values()];
}

function bestAskFromPredictBook(book) {
  const asks = book?.asks ?? [];
  const first = asks[0];
  if (Array.isArray(first)) {
    const price = Number(first[0]);
    const size = Number(first[1]);
    if (Number.isFinite(price) && price > 0 && price < 1 && (!Number.isFinite(size) || size > 0))
      return price;
  }
  let best = Number.POSITIVE_INFINITY;
  for (const level of asks) {
    if (!Array.isArray(level))
      continue;
    const price = Number(level[0]);
    const size = Number(level[1]);
    if (Number.isFinite(price) && price > 0 && price < best && (!Number.isFinite(size) || size > 0))
      best = price;
  }
  return Number.isFinite(best) && best < 1 ? best : 0;
}

async function fetchPredictOrderbooks(marketIds, signal) {
  const unique = [...new Set(marketIds.map(id => String(id)).filter(Boolean))];
  const out = {};
  for (let i = 0; i < unique.length; i += ORDERBOOK_CONCURRENCY) {
    if (signal?.aborted)
      break;
    const chunk = unique.slice(i, i + ORDERBOOK_CONCURRENCY);
    const rows = await Promise.all(chunk.map(async (id) => {
      try {
        const res = await predictHttpGet(
          `${PREDICT_FUN_API}/v1/markets/${encodeURIComponent(id)}/orderbook`,
          signal,
        );
        return { id, book: res?.data ?? null };
      }
      catch {
        return { id, book: null };
      }
    }));
    for (const row of rows) {
      if (row.book)
        out[row.id] = row.book;
    }
  }
  return out;
}

function decimalOddsFromProbability(price) {
  const value = Number(price);
  if (!Number.isFinite(value) || value <= 0 || value >= 1)
    return 0;
  return Math.round((1 / value) * 1000) / 1000;
}

function isTradableMarket(market) {
  const trading = String(market.tradingStatus ?? "OPEN").toUpperCase();
  if (trading && !["OPEN", "MATCHING_NOT_PAUSED"].includes(trading))
    return false;
  const status = String(market.status ?? "").toUpperCase();
  // 官方运动盘常为 REGISTERED + trading OPEN（非电竞 OPEN）
  if (status && !["OPEN", "REGISTERED"].includes(status))
    return false;
  return true;
}

function startTimeMsOf(category) {
  const raw = category.startsAt;
  if (raw) {
    const ms = Date.parse(raw);
    if (Number.isFinite(ms))
      return ms;
  }
  return Date.now();
}

function startTimeAllowed(startMs, pastMs = PAST_MS, futureMs = FUTURE_MS) {
  return sportStartInWindow(startMs, pastMs, futureMs);
}

function yesOutcome(market) {
  const outcomes = market.outcomes ?? [];
  return outcomes.find(o => String(o.name ?? "").toLowerCase() === "yes") ?? outcomes[0];
}

/**
 * 官方 outcome.bestAsk / bestBid 多为 `{ price, size }`（见 Get markets）；
 * 类别快照里也可能是 number | null。
 * @param {unknown} level
 * @returns {number}
 */
export function readPredictTopPrice(level) {
  if (level == null)
    return 0;
  if (typeof level === "number") {
    return Number.isFinite(level) && level > 0 && level < 1 ? level : 0;
  }
  if (typeof level === "string") {
    const n = Number(level);
    return Number.isFinite(n) && n > 0 && n < 1 ? n : 0;
  }
  if (typeof level === "object") {
    const n = Number(/** @type {{ price?: unknown }} */ (level).price);
    return Number.isFinite(n) && n > 0 && n < 1 ? n : 0;
  }
  return 0;
}

/**
 * 买入价优先 bestAsk；若盘口是空洞 tip（如 0.01/0.99）则用 mid，避免假 Locked 与无意义 1.01 倍。
 * @param {object|undefined} outcome
 * @param {number} [bookProb]
 */
export function outcomeProb(outcome, bookProb = 0) {
  const ask = readPredictTopPrice(outcome?.bestAsk);
  const bid = readPredictTopPrice(outcome?.bestBid);
  if (ask > 0 && bid > 0 && (ask - bid) >= 0.5)
    return (ask + bid) / 2;
  if (ask > 0)
    return ask;
  if (Number.isFinite(bookProb) && bookProb > 0 && bookProb < 1)
    return bookProb;
  if (bid > 0)
    return bid;
  return 0;
}

/** Yes 盘是否已有可用报价（可跳过再打 orderbook） */
function outcomeHasUsablePrice(outcome) {
  return outcomeProb(outcome, 0) > 0;
}

/**
 * SPORTS_MATCH：主/客两队盘（跳过 Draw）
 * @returns {{ home: object, away: object, mode: "dual" } | null}
 */
function pickDualTeamMarkets(category) {
  const teamMarkets = (category.markets ?? []).filter((market) => {
    if (!isTradableMarket(market))
      return false;
    const title = String(market.title ?? "").trim().toLowerCase();
    if (title === "draw" || title === "tie")
      return false;
    return Boolean(market.team?.name || (title && title !== "draw"));
  });
  if (teamMarkets.length < 2)
    return null;
  const [home, away] = teamMarkets.slice(0, 2);
  const homeName = String(home.team?.name ?? home.title ?? "").trim();
  const awayName = String(away.team?.name ?? away.title ?? "").trim();
  if (!homeName || !awayName)
    return null;
  return { home, away, mode: "dual" };
}

/**
 * SPORTS_TEAM_MATCH 棒球：单盘双 outcome
 * @returns {{ market: object, homeOutcome: object, awayOutcome: object, mode: "single" } | null}
 */
function pickSingleMoneylineMarket(category) {
  const markets = (category.markets ?? []).filter(isTradableMarket);
  const ml = markets.find(m => String(m.marketType ?? "") === "SPORTS_MONEYLINE")
    || markets.find(m => (m.outcomes ?? []).length >= 2 && (m.outcomes ?? []).every(o => o.team || o.name));
  if (!ml)
    return null;
  const outcomes = ml.outcomes ?? [];
  if (outcomes.length < 2)
    return null;
  const withTeam = outcomes.filter(o => o.team?.name);
  const homeOutcome = withTeam[0] || outcomes[0];
  const awayOutcome = withTeam[1] || outcomes[1];
  if (!homeOutcome || !awayOutcome)
    return null;
  return { market: ml, homeOutcome, awayOutcome, mode: "single" };
}

/**
 * @param {object} category
 * @param {string} wantGame
 */
export function isPredictSportMoneylineCategory(category, wantGame) {
  const variant = String(category.marketVariant ?? "");
  if (!variant.startsWith("SPORTS_"))
    return false;
  if (String(category.status ?? "").toUpperCase() !== "OPEN")
    return false;
  if (resolveSportGameCodeFromCategory(category) !== wantGame)
    return false;
  return Boolean(pickDualTeamMarkets(category) || pickSingleMoneylineMarket(category));
}

function stableMatchId(key, idBase) {
  let h = 0;
  const s = String(key);
  for (let i = 0; i < s.length; i += 1)
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  const n = Math.abs(h) || 1;
  return idBase + (n % 99_000_000);
}

/**
 * 棒球产品线下细分联赛（展示用 Game；合并时同联赛才配对）。
 * 优先官方 Team.league（required）；无则回退 title/tag。
 * @param {object} category
 * @returns {"mlb"|"kbo"|"npb"}
 */
export function resolveBaseballLeagueGame(category) {
  const allow = new Set(["mlb", "kbo", "npb"]);
  /** @type {string[]} */
  const leagues = [];
  for (const team of category?.teams ?? []) {
    const league = String(team?.league ?? "").toLowerCase().trim();
    if (league)
      leagues.push(league);
  }
  for (const market of category?.markets ?? []) {
    const league = String(market?.team?.league ?? "").toLowerCase().trim();
    if (league)
      leagues.push(league);
    for (const outcome of market?.outcomes ?? []) {
      const ol = String(outcome?.team?.league ?? "").toLowerCase().trim();
      if (ol)
        leagues.push(ol);
    }
  }
  for (const league of leagues) {
    if (allow.has(league))
      return /** @type {"mlb"|"kbo"|"npb"} */ (league);
  }

  const title = String(category?.title ?? "").trim();
  const tagNames = (category?.tags ?? []).map(t => String(t.name ?? "").trim().toLowerCase()).filter(Boolean);
  const lower = new Set(tagNames);
  if (lower.has("kbo") || /^kbo\b/i.test(title))
    return "kbo";
  if (lower.has("npb") || /^npb\b/i.test(title))
    return "npb";
  if (lower.has("mlb"))
    return "mlb";
  return "mlb";
}

/**
 * 足球联赛 Game（与 PM sport key 对齐）。
 * @param {object} category
 * @returns {string}
 */
export function resolveFootballLeagueGame(category) {
  const allow = new Set(FOOTBALL_LEAGUE_CODES);
  for (const team of category?.teams ?? []) {
    const league = String(team?.league ?? "").toLowerCase().trim();
    if (allow.has(league))
      return league;
    const fromLeague = resolveFootballLeagueFromText(league);
    if (fromLeague)
      return fromLeague;
  }
  for (const tag of category?.tags ?? []) {
    // PF 偶发 string tag；正规为 { name }
    const name = typeof tag === "string" ? tag : String(tag?.name ?? "");
    const fromTag = resolveFootballLeagueFromText(name);
    if (fromTag)
      return fromTag;
    const low = name.toLowerCase().trim();
    if (allow.has(low))
      return low;
  }
  const fromTitle = resolveFootballLeagueFromText(String(category?.title ?? ""));
  if (fromTitle)
    return fromTitle;
  const fromSlug = resolveFootballLeagueFromText(String(category?.slug ?? ""));
  if (fromSlug)
    return fromSlug;
  return UNKNOWN_FOOTBALL_GAME;
}

/**
 * @param {object} category
 * @param {Record<string, number>} buyPrices marketId → best ask
 * @param {string} gameCode
 * @param {number} idBase
 */
function categoryToClientMatchDto(category, buyPrices, gameCode, idBase) {
  const categoryId = String(category.slug ?? category.id ?? "");
  const sourceMatchId = String(category.id ?? category.slug ?? categoryId);
  if (!categoryId || !sourceMatchId)
    return null;

  const dual = pickDualTeamMarkets(category);
  const single = dual ? null : pickSingleMoneylineMarket(category);
  if (!dual && !single)
    return null;

  let homeName;
  let awayName;
  let homeOdds = 0;
  let awayOdds = 0;
  let homeId;
  let awayId;

  /** @type {string} */
  let homeMarketId = "";
  /** @type {string} */
  let awayMarketId = "";

  if (dual) {
    homeName = String(dual.home.team?.name ?? dual.home.title ?? "").trim();
    awayName = String(dual.away.team?.name ?? dual.away.title ?? "").trim();
    homeMarketId = String(dual.home.id ?? "");
    awayMarketId = String(dual.away.id ?? "");
    const homeYes = yesOutcome(dual.home);
    const awayYes = yesOutcome(dual.away);
    homeOdds = decimalOddsFromProbability(outcomeProb(homeYes, buyPrices[homeMarketId]));
    awayOdds = decimalOddsFromProbability(outcomeProb(awayYes, buyPrices[awayMarketId]));
    homeId = String(homeYes?.onChainId ?? homeMarketId);
    awayId = String(awayYes?.onChainId ?? awayMarketId);
  }
  else {
    homeName = String(single.homeOutcome.team?.name ?? single.homeOutcome.name ?? "").trim();
    awayName = String(single.awayOutcome.team?.name ?? single.awayOutcome.name ?? "").trim();
    const marketId = String(single.market.id ?? "");
    homeMarketId = marketId;
    awayMarketId = marketId;
    // 单盘双 outcome：优先 outcome.bestAsk；orderbook 常为空
    homeOdds = decimalOddsFromProbability(outcomeProb(single.homeOutcome, 0));
    awayOdds = decimalOddsFromProbability(outcomeProb(single.awayOutcome, 0));
    homeId = String(single.homeOutcome.onChainId ?? `${marketId}-home`);
    awayId = String(single.awayOutcome.onChainId ?? `${marketId}-away`);
  }

  if (!homeName || !awayName)
    return null;

  // 去掉 "KBO: " 等前缀，避免与 PM 队名对不齐
  homeName = homeName.replace(/^(kbo|npb|mlb)\s*:\s*/i, "").trim() || homeName;
  awayName = awayName.replace(/^(kbo|npb|mlb)\s*:\s*/i, "").trim() || awayName;
  // 足球：偶发盘口线写进队名 "Yunnan Yukun FC (-1.5)"
  if (gameCode === "soccer") {
    homeName = stripFootballHandicapSuffix(homeName) || homeName;
    awayName = stripFootballHandicapSuffix(awayName) || awayName;
  }

  const locked = !homeOdds || !awayOdds;
  const startTime = startTimeMsOf(category);
  const matchId = stableMatchId(`pf:${sourceMatchId}`, idBase);
  const betId = encodeSportBetId(matchId, 1);
  const rawTitle = String(category.title ?? `${homeName} vs ${awayName}`).trim();
  const title = gameCode === "soccer"
    ? (baseFootballEventTitle(rawTitle) || `${homeName} vs ${awayName}`)
    : rawTitle;
  const dtoGame = gameCode === "mlb"
    ? resolveBaseballLeagueGame(category)
    : gameCode === "soccer"
      ? resolveFootballLeagueGame(category)
      : gameCode;

  return {
    ID: matchId,
    Title: title,
    Game: dtoGame,
    GameID: 0,
    StartTime: startTime,
    Matchs: {
      PredictFun: sourceMatchId,
    },
    Bets: [{
      ID: betId,
      MatchID: matchId,
      Map: 0,
      Name: displayBetName(MARKET_MONEYLINE, null),
      MarketCode: MARKET_MONEYLINE,
      Line: null,
      HomeID: betId * 10 + 1,
      HomeName: homeName,
      AwayID: betId * 10 + 2,
      AwayName: awayName,
      Sources: {
        PredictFun: {
          Type: "PredictFun",
          BetID: categoryId,
          HomeID: homeId,
          AwayID: awayId,
          HomeOdds: homeOdds,
          AwayOdds: awayOdds,
          Status: locked ? "Locked" : "Normal",
          // [changmen 扩展] 体育实时盘口 WS 订阅用（onChainId 与 orderbook marketId 不同）
          HomeMarketID: homeMarketId,
          AwayMarketID: awayMarketId,
        },
      },
    }],
  };
}

/**
 * @typedef {object} SportPredictFunOptions
 * @property {string} gameCode mlb | soccer | tennis
 * @property {string} cacheKey
 * @property {number} idBase
 * @property {string} [logTag]
 * @property {number} [pastMs]
 * @property {number} [futureMs]
 */

/**
 * @param {SportPredictFunOptions} options
 * @returns {Promise<object[]>}
 */
export async function fetchPredictFunSportAsClientMatchDtos(options) {
  const gameCode = String(options.gameCode || "").toLowerCase();
  if (gameCode !== "mlb" && gameCode !== "soccer" && gameCode !== "tennis")
    throw new Error(`unsupported PredictFun sport gameCode: ${options.gameCode}`);

  const cacheKey = String(options.cacheKey || `${gameCode}_pf`);
  const idBase = Number(options.idBase)
    || (gameCode === "mlb" ? 910_000_000 : gameCode === "tennis" ? 930_000_000 : 810_000_000);
  const logTag = String(options.logTag || `sportPf:${cacheKey}`);
  const pastMs = Number(options.pastMs);
  const futureMs = Number(options.futureMs);
  const winPast = Number.isFinite(pastMs) && pastMs >= 0 ? pastMs : PAST_MS;
  const winFuture = Number.isFinite(futureMs) && futureMs > 0 ? futureMs : FUTURE_MS;
  const crop = (rows) => cropSportMatchListWindow(rows, winPast, winFuture);

  const mem = _caches.get(cacheKey);
  if (mem && Date.now() - mem.at < CACHE_TTL_MS)
    return crop(mem.rows);

  const diskFresh = readFreshSportListCache(cacheKey);
  if (diskFresh) {
    _caches.set(cacheKey, { at: diskFresh.at, rows: diskFresh.rows });
    return crop(diskFresh.rows);
  }

  let live = _inflight.get(cacheKey);
  if (!live) {
    const signal = abortAfter(LIVE_BUDGET_MS);
    live = (async () => {
      if (!resolvePredictFunApiKey())
        throw new Error("PREDICT_FUN_API_KEY 未配置");

      const rawCategories = await fetchPredictCategoriesForGame(gameCode, signal);
      const moneylineCats = rawCategories.filter((category) => {
        if (!isPredictSportMoneylineCategory(category, gameCode))
          return false;
        return startTimeAllowed(startTimeMsOf(category), winPast, winFuture);
      });
      const propsCats = gameCode === "soccer"
        ? rawCategories.filter((category) => {
          if (String(category.marketVariant ?? "") !== "SPORTS_PROPS")
            return false;
          if (String(category.status ?? "").toUpperCase() !== "OPEN")
            return false;
          if (!isFootballSiblingEventTitle(String(category.title ?? "")))
            return false;
          return startTimeAllowed(startTimeMsOf(category), winPast, winFuture);
        })
        : [];

      const marketIds = [];
      for (const category of moneylineCats) {
        const dual = pickDualTeamMarkets(category);
        if (dual) {
          const homeYes = yesOutcome(dual.home);
          const awayYes = yesOutcome(dual.away);
          if (!outcomeHasUsablePrice(homeYes) && dual.home.id != null)
            marketIds.push(String(dual.home.id));
          if (!outcomeHasUsablePrice(awayYes) && dual.away.id != null)
            marketIds.push(String(dual.away.id));
        }
      }

      const books = marketIds.length
        ? await fetchPredictOrderbooks(marketIds.slice(0, MAX_TRACKED * 2), signal)
        : {};
      const buyPrices = {};
      for (const [id, book] of Object.entries(books)) {
        const ask = bestAskFromPredictBook(book);
        if (ask > 0 && ask < 1)
          buyPrices[id] = ask;
      }

      /** @type {Map<string, object>} */
      const byBase = new Map();
      const rows = [];
      for (const category of moneylineCats) {
        const dto = categoryToClientMatchDto(category, buyPrices, gameCode, idBase);
        if (!dto)
          continue;
        rows.push(dto);
        const base = baseFootballEventTitle(String(dto.Title || "")).toLowerCase();
        if (base)
          byBase.set(`${dto.Game}|${base}`, dto);
        if (rows.length >= MAX_TRACKED)
          break;
      }

      for (const propsCat of propsCats) {
        const base = baseFootballEventTitle(String(propsCat.title ?? "")).toLowerCase();
        if (!base)
          continue;
        const league = resolveFootballLeagueGame(propsCat);
        let dto = byBase.get(`${league}|${base}`);
        if (!dto) {
          const candidates = [...byBase.values()].filter(d =>
            baseFootballEventTitle(String(d.Title || "")).toLowerCase() === base);
          const lg = String(league || "").toLowerCase();
          dto = candidates.find(d => String(d.Game || "").toLowerCase() === lg)
            || (FOOTBALL_FALLBACK_GAMES.has(lg)
              ? candidates[0]
              : candidates.find(d => FOOTBALL_FALLBACK_GAMES.has(String(d.Game || "").toLowerCase())))
            || null;
        }
        if (!dto)
          continue;
        appendPredictFootballPropsBets(dto, propsCat);
      }

      const cropped = crop(rows);
      persistPredictRows(cacheKey, cropped, logTag);
      return cropped;
    })()
      .catch((err) => {
        const diskAny = readSportListCache(cacheKey);
        if (diskAny?.rows?.length) {
          console.warn(`[${logTag}] predict.fun failed, serving stale disk cache`, err?.message || err);
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
  if (staleRows.length) {
    live.catch((err) => {
      console.warn(`[${logTag}] background refresh failed`, err?.message || err);
    });
    return staleRows;
  }
  return live;
}

/**
 * 把 SPORTS_PROPS 里的 spreads/totals 挂到胜负 DTO 上。
 * @param {object} dto
 * @param {object} category
 */
function appendPredictFootballPropsBets(dto, category) {
  const ml = dto.Bets?.[0];
  if (!ml)
    return;
  const homeName = String(ml.HomeName || "");
  const awayName = String(ml.AwayName || "");
  const matchId = Number(dto.ID) || 0;
  let betSeq = dto.Bets.length;
  /** @type {Set<string>} */
  const seen = new Set(
    dto.Bets.map(b => `${b.MarketCode || MARKET_MONEYLINE}|${b.Line ?? ""}`),
  );

  for (const market of category.markets ?? []) {
    if (!isTradableMarket(market))
      continue;
    const mt = String(market.marketType ?? "");
    const outcomes = market.outcomes ?? [];
    if (outcomes.length < 2)
      continue;
    const marketId = String(market.id ?? "");

    if (mt === "SPORTS_SPREADS") {
      const listedLine = parseLineFromTitle(String(market.title ?? ""));
      if (listedLine == null)
        continue;
      const listedTeam = String(market.title ?? "")
        .replace(/\s*\([+-]?\d+(?:\.\d+)?\)\s*$/, "")
        .trim();
      const homeRel = teamMatchesLabel(listedTeam, homeName)
        ? listedLine
        : teamMatchesLabel(listedTeam, awayName)
          ? -listedLine
          : listedLine;
      const key = `${MARKET_SPREADS}|${homeRel}`;
      if (seen.has(key))
        continue;
      const o0 = outcomes[0];
      const o1 = outcomes[1];
      const odds0 = decimalOddsFromProbability(outcomeProb(o0, 0));
      const odds1 = decimalOddsFromProbability(outcomeProb(o1, 0));
      const listedIsHome = teamMatchesLabel(listedTeam, homeName)
        || (!teamMatchesLabel(listedTeam, awayName) && homeRel === listedLine);
      betSeq += 1;
      const betId = encodeSportBetId(matchId, betSeq);
      dto.Bets.push({
        ID: betId,
        MatchID: matchId,
        Map: 0,
        Name: displayBetName(MARKET_SPREADS, homeRel),
        MarketCode: MARKET_SPREADS,
        Line: homeRel,
        HomeID: betId * 10 + 1,
        HomeName: homeName,
        AwayID: betId * 10 + 2,
        AwayName: awayName,
        Sources: {
          PredictFun: {
            Type: "PredictFun",
            BetID: marketId || String(category.id ?? ""),
            HomeID: String((listedIsHome ? o0 : o1)?.onChainId ?? `${marketId}-home`),
            AwayID: String((listedIsHome ? o1 : o0)?.onChainId ?? `${marketId}-away`),
            HomeOdds: listedIsHome ? odds0 : odds1,
            AwayOdds: listedIsHome ? odds1 : odds0,
            Status: (listedIsHome ? odds0 : odds1) && (listedIsHome ? odds1 : odds0) ? "Normal" : "Locked",
            HomeMarketID: marketId,
            AwayMarketID: marketId,
          },
        },
      });
      seen.add(key);
      continue;
    }

    if (mt === "SPORTS_TOTALS") {
      const line = parseLineFromTitle(String(market.title ?? ""));
      if (line == null)
        continue;
      const key = `${MARKET_TOTALS}|${line}`;
      if (seen.has(key))
        continue;
      let over = outcomes.find(o => /^over/i.test(String(o.name ?? o.title ?? "")));
      let under = outcomes.find(o => /^under/i.test(String(o.name ?? o.title ?? "")));
      if (!over || !under) {
        over = outcomes[0];
        under = outcomes[1];
      }
      const overOdds = decimalOddsFromProbability(outcomeProb(over, 0));
      const underOdds = decimalOddsFromProbability(outcomeProb(under, 0));
      betSeq += 1;
      const betId = encodeSportBetId(matchId, betSeq);
      dto.Bets.push({
        ID: betId,
        MatchID: matchId,
        Map: 0,
        Name: displayBetName(MARKET_TOTALS, line),
        MarketCode: MARKET_TOTALS,
        Line: line,
        HomeID: betId * 10 + 1,
        HomeName: "大",
        AwayID: betId * 10 + 2,
        AwayName: "小",
        Sources: {
          PredictFun: {
            Type: "PredictFun",
            BetID: marketId || String(category.id ?? ""),
            HomeID: String(over?.onChainId ?? `${marketId}-over`),
            AwayID: String(under?.onChainId ?? `${marketId}-under`),
            HomeOdds: overOdds,
            AwayOdds: underOdds,
            Status: overOdds && underOdds ? "Normal" : "Locked",
            HomeMarketID: marketId,
            AwayMarketID: marketId,
          },
        },
      });
      seen.add(key);
    }
  }
}

function teamMatchesLabel(label, teamName) {
  const a = String(label || "").toLowerCase().trim();
  const b = String(teamName || "").toLowerCase().trim();
  if (!a || !b)
    return false;
  if (a === b || a.includes(b) || b.includes(a))
    return true;
  const last = b.split(/\s+/).pop() || "";
  return last.length > 2 && a.includes(last);
}

export async function fetchPredictFunMlbAsClientMatchDtos() {
  return fetchPredictFunSportAsClientMatchDtos({
    gameCode: "mlb",
    cacheKey: "mlb_pf",
    idBase: 910_000_000,
    logTag: "mlbPredictFun",
  });
}

export async function fetchPredictFunFootballAsClientMatchDtos() {
  return fetchPredictFunSportAsClientMatchDtos({
    gameCode: "soccer",
    cacheKey: "soccer_pf6",
    idBase: 810_000_000,
    logTag: "footballPredictFun",
    pastMs: PREDICT_FUN_FOOTBALL_PAST_MS,
    futureMs: FOOTBALL_LIST_FUTURE_MS,
  });
}

export async function fetchPredictFunTennisAsClientMatchDtos() {
  return fetchPredictFunSportAsClientMatchDtos({
    gameCode: "tennis",
    cacheKey: "tennis_pf",
    idBase: 930_000_000,
    logTag: "tennisPredictFun",
  });
}

export async function fetchPredictFunNbaAsClientMatchDtos() {
  return fetchPredictFunSportAsClientMatchDtos({
    gameCode: "nba",
    cacheKey: "nba_pf",
    idBase: 950_000_000,
    logTag: "nbaPredictFun",
  });
}

export function clearSportPredictFunCache(cacheKey) {
  if (cacheKey) {
    _caches.delete(cacheKey);
    _inflight.delete(cacheKey);
    return;
  }
  _caches.clear();
  _inflight.clear();
}
