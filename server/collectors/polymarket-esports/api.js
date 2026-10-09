/**
 * Polymarket Gamma + CLOB（VPS 直连，不经浏览器插件）
 * 对齐官方：events/keyset、/sports、/sports/market-types、POST /prices side=SELL
 * https://docs.polymarket.com/api-reference/events/list-events-keyset-pagination
 * https://docs.polymarket.com/api-reference/sports/get-sports-metadata-information
 * https://docs.polymarket.com/api-reference/sports/get-valid-sports-market-types
 * https://docs.polymarket.com/api-reference/market-data/get-market-prices-request-body
 * https://docs.polymarket.com/market-data/fetching-markets （列盘主路径 closed=false）
 *
 * 入选（相对官方）：
 * 1) 每请求必带 closed=false + series_id + keyset cursor
 * 2) 主 pass：start_time ∈ [now-6h, now+1h]（控制分页体积；开赛已过但未 ended 的盘仍在窗内）
 * 3) 补 pass：live=true（开赛可能远早于 6h 但仍标 live 的长局）
 * 4) 本地再丢 ended===true（OpenAPI 无 ended 查询参数；live 不可靠，不能当唯一门控）
 */

import { normalizeEpochMs } from "@changmen/shared/time/match_time";

export const POLYMARKET_GAMMA_API = "https://gamma-api.polymarket.com";
export const POLYMARKET_CLOB_API = "https://clob.polymarket.com";

/** 主 pass 向过去保留 6 小时：已开赛、closed=false、但 live 尚未翻 true 的场次 */
const COLLECT_PAST_MS = 6 * 3600 * 1000;
const COLLECT_FUTURE_MS = 3600 * 1000;
const KEYSET_PAGE_LIMIT = 500;
const MAX_KEYSET_PAGES = 3;
const SPORTS_METADATA_TTL_MS = 60 * 60_000;
const MARKET_TYPES_TTL_MS = 6 * 3600 * 1000;
const ESPORTS_SPORT_KEYS = ["cs2", "lol", "dota2", "hok", "val"];
const DEFAULT_ESPORTS_SERIES_IDS = ["10310", "10311", "10309", "10434", "10369"];

/** 产品主盘；须 ⊆ 官方 GET /sports/market-types */
export const BASE_COLLECT_MARKET_TYPES = ["moneyline", "child_moneyline"];

export const POLYMARKET_COLLECT_PAST_MS = COLLECT_PAST_MS;
export const POLYMARKET_COLLECT_FUTURE_MS = COLLECT_FUTURE_MS;

/** @type {{ ids: string[], expiresAt: number } | null} */
let esportsSeriesCache = null;
/** @type {{ types: Set<string>, expiresAt: number, fromOfficial: boolean } | null} */
let marketTypesCache = null;

/**
 * 官方响应字段：未关闭且未结束才纳入采集。
 * ended 无查询参数，只能本地滤；勿用 live===true 当充分条件。
 * @param {object|null|undefined} event
 */
export function polymarketEventOpenForCollect(event) {
  if (!event || typeof event !== "object")
    return false;
  if (event.closed === true)
    return false;
  if (event.ended === true)
    return false;
  return true;
}

/**
 * 是否可绕过 48h 软保留、立即强制删除。
 * 只认稳定单调的 `closed`（官方：已结算/被禁用，阻止进一步交易），
 * **不看 `ended`**——官方明示 ended「may fluctuate, have latency」，
 * 结算过渡期会在 true/false 间抖动，据此强删会导致 client_match ID 反复重建。
 * ended 但未 closed 的场交给软保留（48h stale）与下游 ended_filter 处理，不强删。
 * @param {object|null|undefined} event
 */
export function polymarketEventForceDeletable(event) {
  if (!event || typeof event !== "object")
    return false;
  return event.closed === true;
}

/** 本地二次滤只拒绝更远的未开赛；已开赛（含 live 补 pass）允许 */
export function polymarketCollectStartTimeAllowed(startMs) {
  const ms = normalizeEpochMs(startMs);
  if (!ms)
    return true;
  return ms <= Date.now() + COLLECT_FUTURE_MS;
}
/** 官方字段规范化；禁止默认 moneyline */
export function normalizeSportsMarketType(market) {
  const raw = market?.sportsMarketType ?? market?.sports_market_type ?? "";
  return String(raw).trim().toLowerCase();
}

function extraMarketTypesFromEnv() {
  const raw = String(process.env.POLYMARKET_COLLECTOR_EXTRA_MARKET_TYPES || "").trim();
  if (!raw)
    return [];
  return raw.split(/[,;\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
}

function unwrapArray(data) {
  if (Array.isArray(data))
    return data;
  if (data && typeof data === "object") {
    if (Array.isArray(data.markets))
      return data.markets;
    if (Array.isArray(data.events))
      return data.events;
    if (Array.isArray(data.data))
      return data.data;
    if (Array.isArray(data.marketTypes))
      return data.marketTypes;
  }
  return [];
}

async function fetchJson(url, init) {
  const res = await fetch(url, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init?.headers || {}),
    },
    signal: init?.signal ?? AbortSignal.timeout(25_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text.trim() || `HTTP ${res.status} ${url}`);
  }
  return res.json();
}

function marketWithEventContext(market, event) {
  const type = normalizeSportsMarketType(market);
  return {
    ...market,
    gameStartTime: market.gameStartTime ?? event.startTime,
    startDate: market.startDate ?? event.startDate,
    // 勿默认 "moneyline"；只回填已规范化的官方类型（可空）
    ...(type
      ? { sportsMarketType: type, sports_market_type: type }
      : {}),
    tags: market.tags ?? event.tags,
    events: [event],
  };
}

function marketKeyOf(market) {
  return String(market.condition_id ?? market.conditionId ?? market.market ?? market.id ?? "");
}

function nextKeysetCursor(data) {
  if (!data || typeof data !== "object")
    return "";
  return String(data.next_cursor ?? data.nextCursor ?? "");
}

async function fetchEsportsSeriesIds() {
  const now = Date.now();
  if (esportsSeriesCache && esportsSeriesCache.expiresAt > now)
    return esportsSeriesCache.ids;

  try {
    const sports = unwrapArray(await fetchJson(`${POLYMARKET_GAMMA_API}/sports`));
    const ids = sports
      .filter(row => row?.sport && ESPORTS_SPORT_KEYS.includes(String(row.sport)))
      .map(row => String(row.series ?? "").trim())
      .filter(Boolean);
    if (ids.length) {
      esportsSeriesCache = { ids: [...new Set(ids)], expiresAt: now + SPORTS_METADATA_TTL_MS };
      return esportsSeriesCache.ids;
    }
  }
  catch (err) {
    console.warn("[polymarket-esports] sports metadata fallback:", err.message);
  }

  esportsSeriesCache = {
    ids: DEFAULT_ESPORTS_SERIES_IDS,
    expiresAt: now + SPORTS_METADATA_TTL_MS,
  };
  return esportsSeriesCache.ids;
}

/**
 * 产品 allowlist ∩ 官方 /sports/market-types（失败则用 BASE，并打日志）
 * @returns {Promise<Set<string>>}
 */
export async function resolveCollectMarketTypes() {
  const now = Date.now();
  if (marketTypesCache && marketTypesCache.expiresAt > now)
    return marketTypesCache.types;

  const wanted = new Set([
    ...BASE_COLLECT_MARKET_TYPES,
    ...extraMarketTypesFromEnv(),
  ]);

  try {
    const data = await fetchJson(`${POLYMARKET_GAMMA_API}/sports/market-types`);
    const official = new Set(
      unwrapArray(data).map(t => String(t).trim().toLowerCase()).filter(Boolean),
    );
    const intersect = [...wanted].filter(t => official.has(t));
    if (!intersect.length) {
      console.warn(
        "[polymarket-esports] market-types intersect empty; keep BASE",
        { wanted: [...wanted], officialSample: [...official].slice(0, 8) },
      );
      marketTypesCache = {
        types: new Set(BASE_COLLECT_MARKET_TYPES),
        expiresAt: now + MARKET_TYPES_TTL_MS,
        fromOfficial: false,
      };
      return marketTypesCache.types;
    }
    for (const t of wanted) {
      if (!official.has(t))
        console.warn(`[polymarket-esports] market type not in official list: ${t}`);
    }
    marketTypesCache = {
      types: new Set(intersect),
      expiresAt: now + MARKET_TYPES_TTL_MS,
      fromOfficial: true,
    };
    return marketTypesCache.types;
  }
  catch (err) {
    console.warn("[polymarket-esports] market-types fetch failed:", err.message);
    marketTypesCache = {
      types: new Set(BASE_COLLECT_MARKET_TYPES),
      expiresAt: now + 5 * 60_000,
      fromOfficial: false,
    };
    return marketTypesCache.types;
  }
}

/**
 * @param {string[]} seriesIds
 * @param {number} pageLimit
 * @param {Record<string, string>} extraParams
 * @param {Set<string>} seenMarketIds
 * @param {object[]} blocks
 * @param {Set<string>} [excludeSourceMatchIds] 上游已 closed（稳定终态）的 event.id，绕过软保留立即删；ended 不入此集
 * @returns {Promise<number>} rawEventCount（含本地丢弃前的上游事件数）
 */
async function fetchEsportsKeysetPass(
  seriesIds,
  pageLimit,
  extraParams,
  seenMarketIds,
  blocks,
  excludeSourceMatchIds,
) {
  let cursor = "";
  let rawEventCount = 0;
  for (let page = 0; page < MAX_KEYSET_PAGES; page += 1) {
    const params = new URLSearchParams({
      // [官方] Discover Markets：列未关闭盘
      closed: "false",
      limit: String(pageLimit),
      order: "startTime",
      ascending: "true",
      ...extraParams,
    });
    for (const id of seriesIds)
      params.append("series_id", id);
    if (cursor)
      params.set("after_cursor", cursor);

    const data = await fetchJson(`${POLYMARKET_GAMMA_API}/events/keyset?${params.toString()}`);
    const events = unwrapArray(data);
    rawEventCount += events.length;
    for (const event of events) {
      const sid = String(event?.id ?? "").trim();
      if (!polymarketEventOpenForCollect(event)) {
        // 只有稳定终态 closed 才进强删名单；ended 会抖（官方明示），仅跳过采集、不强删
        if (sid && excludeSourceMatchIds && polymarketEventForceDeletable(event))
          excludeSourceMatchIds.add(sid);
        continue;
      }
      const markets = Array.isArray(event.markets) ? event.markets : [];
      for (const market of markets) {
        // [changmen 扩展] 活跃赛事的已关闭地图仍需查官方胜方，供比赛卡展示结果。
        if (market?.archived === true)
          continue;
        const marketKey = marketKeyOf(market);
        if (marketKey && seenMarketIds.has(marketKey))
          continue;
        if (marketKey)
          seenMarketIds.add(marketKey);
        blocks.push(marketWithEventContext(market, event));
      }
    }
    cursor = nextKeysetCursor(data);
    if (!cursor)
      break;
  }
  return rawEventCount;
}

/**
 * 官方 closed=false + series；主窗 start_time + 补 pass live（live 不可单独依赖）。
 * @returns {Promise<{
 *   markets: object[],
 *   rawEventCount: number,
 *   rawMarketCount: number,
 *   excludeSourceMatchIds: string[],
 * }>}
 */
export async function fetchPolymarketEsportsMarkets() {
  const pageLimit = KEYSET_PAGE_LIMIT;
  const blocks = [];
  const seenMarketIds = new Set();
  /** @type {Set<string>} */
  const excludeSourceMatchIds = new Set();
  const seriesIds = await fetchEsportsSeriesIds();
  const now = Date.now();

  // 主 pass：未关闭 + 开赛窗（覆盖 live 滞后的已开赛场）
  const windowEvents = await fetchEsportsKeysetPass(
    seriesIds,
    pageLimit,
    {
      start_time_min: new Date(now - COLLECT_PAST_MS).toISOString(),
      start_time_max: new Date(now + COLLECT_FUTURE_MS).toISOString(),
    },
    seenMarketIds,
    blocks,
    excludeSourceMatchIds,
  );
  // 补 pass：仍标 live 但开赛可能早于 past 窗的长局
  const liveEvents = await fetchEsportsKeysetPass(
    seriesIds,
    pageLimit,
    { live: "true" },
    seenMarketIds,
    blocks,
    excludeSourceMatchIds,
  );

  return {
    markets: blocks,
    rawEventCount: windowEvents + liveEvents,
    rawMarketCount: blocks.length,
    excludeSourceMatchIds: [...excludeSourceMatchIds],
  };
}
/**
 * 官方：买入看 SELL（best ask）。每批 ≤200。
 * @param {string[]} assetIds
 * @returns {Promise<Record<string, number>>}
 */
export async function fetchBatchBuyPrices(assetIds) {
  if (!assetIds.length)
    return {};
  const CHUNK = 200;
  const result = {};
  for (let i = 0; i < assetIds.length; i += CHUNK) {
    const chunk = assetIds.slice(i, i + CHUNK);
    const body = chunk.map(token_id => ({ token_id, side: "SELL" }));
    try {
      const data = await fetchJson(`${POLYMARKET_CLOB_API}/prices`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      for (const [tokenId, sides] of Object.entries(data ?? {})) {
        const price = Number(sides?.SELL ?? 0);
        if (price > 0 && price < 1)
          result[tokenId] = price;
      }
    }
    catch (err) {
      console.warn("[polymarket-esports] /prices chunk failed:", err.message);
    }
  }
  return result;
}

/**
 * [changmen 扩展] 比赛卡胜负独立读取 CLOB tokens[].winner；Gamma 价格不参与。
 * 保留 Gamma 的 token 顺序和赛事上下文，避免 CLOB 主客顺序变化导致胜方反转。
 * 全批共享 10s 截止、最多 8 个并发；查询失败不生成胜方，也不阻断行情采集。
 * @param {object[]} markets 已通过形状/时间窗校验并限制数量的市场
 * @returns {Promise<object[]>}
 */
export async function fetchPolymarketOfficialMarkets(markets) {
  if (!markets.length)
    return [];
  const signal = AbortSignal.timeout(10_000);
  const enriched = Array.from({ length: markets.length });
  let cursor = 0;
  let failed = 0;
  await Promise.all(Array.from({ length: Math.min(8, markets.length) }, async () => {
    while (cursor < markets.length) {
      const i = cursor++;
      const market = markets[i];
      const id = marketKeyOf(market);
      enriched[i] = { ...market, tokens: [] };
      if (!id || signal.aborted) {
        failed++;
        continue;
      }
      try {
        const clob = await fetchJson(`${POLYMARKET_CLOB_API}/markets/${encodeURIComponent(id)}`, { signal });
        // [changmen 扩展] 拒绝错盘响应；仅 overlay 官方 token 结果，不覆盖 Gamma 赛事归属。
        if (String(clob?.condition_id ?? "") !== id || !Array.isArray(clob?.tokens)) {
          failed++;
          continue;
        }
        enriched[i] = { ...market, tokens: clob.tokens };
      }
      catch {
        failed++;
      }
    }
  }));
  if (failed)
    console.warn(`[polymarket-esports] official outcomes unavailable: ${failed}/${markets.length}; no price fallback`);
  return enriched;
}

/**
 * 按 SourceMatchID 整场截断：凑不下整场则停，避免同场只剩一半地图盘。
 * @template T
 * @param {T[]} ordered
 * @param {(row: T) => string} matchIdOf
 * @param {number} maxMarkets
 * @returns {T[]}
 */
export function takeWholeMatchesUpTo(ordered, matchIdOf, maxMarkets) {
  const max = Math.max(0, Number(maxMarkets) || 0);
  if (!max || !ordered.length)
    return [];
  /** @type {Map<string, T[]>} */
  const groups = new Map();
  /** @type {string[]} */
  const order = [];
  for (const row of ordered) {
    const sid = String(matchIdOf(row) || "").trim() || "__anon__";
    if (!groups.has(sid)) {
      groups.set(sid, []);
      order.push(sid);
    }
    groups.get(sid).push(row);
  }
  const out = [];
  for (const sid of order) {
    const group = groups.get(sid) || [];
    if (out.length + group.length > max) {
      // 单场本身超过上限：保留该场前 max 盘，避免整轮 candidates 为空误走 skip-clear
      if (out.length === 0 && group.length > max)
        out.push(...group.slice(0, max));
      break;
    }
    out.push(...group);
  }
  return out;
}

/** 测试用 */
export function resetPolymarketEsportsApiCachesForTests() {
  esportsSeriesCache = null;
  marketTypesCache = null;
}
