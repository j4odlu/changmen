/**
 * Gamma API：gameId ↔ event id/slug（VPS 直连，不经过浏览器插件）
 */

const POLYMARKET_GAMMA_API = "https://gamma-api.polymarket.com";
const ESPORTS_SPORT_KEYS = ["cs2", "lol", "dota2", "hok", "val"];
const DEFAULT_ESPORTS_SERIES_IDS = ["10310", "10311", "10309", "10434", "10369"];
const COLLECT_PAST_MS = 6 * 3600 * 1000;
const COLLECT_FUTURE_MS = 3600 * 1000;
const KEYSET_PAGE_LIMIT = 500;
const MAX_KEYSET_PAGES = 3;

/** [changmen 扩展] 只补赛事身份；比分与状态始终保留 WS 原始字段。 */
export function withGammaSportIdentity(msg, gammaIndex) {
  const row = gammaIndex?.byGameId?.get(Number(msg.gameId))
    || gammaIndex?.bySlug?.get(String(msg.slug || ""));
  if (!row)
    return msg;
  return {
    ...msg,
    eventId: msg.eventId ?? row.id,
    slug: msg.slug || row.slug,
  };
}

function unwrapEvents(data) {
  if (Array.isArray(data))
    return data;
  if (data && typeof data === "object") {
    if (Array.isArray(data.data))
      return data.data;
    if (Array.isArray(data.events))
      return data.events;
  }
  return [];
}

function nextCursor(data) {
  if (!data || typeof data !== "object")
    return "";
  return String(data.next_cursor ?? data.nextCursor ?? "");
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok)
    throw new Error(`Gamma ${res.status} ${url}`);
  return res.json();
}

async function fetchEsportsSeriesIds() {
  try {
    const sports = unwrapEvents(await fetchJson(`${POLYMARKET_GAMMA_API}/sports`));
    const ids = sports
      .filter(row => row?.sport && ESPORTS_SPORT_KEYS.includes(String(row.sport)))
      .map(row => String(row.series ?? "").trim())
      .filter(Boolean);
    if (ids.length)
      return [...new Set(ids)];
  }
  catch (err) {
    console.warn("[pm-sports] Gamma /sports fallback:", err.message);
  }
  return DEFAULT_ESPORTS_SERIES_IDS;
}

function gammaEventRowFromApi(event) {
  if (!event || typeof event !== "object")
    return null;
  const id = event?.id != null ? String(event.id) : "";
  const slug = event?.slug != null ? String(event.slug) : "";
  const gameIdRaw = event?.gameId;
  const gameId = gameIdRaw != null ? Number(gameIdRaw) : null;
  if (!id && !slug)
    return null;
  return {
    id,
    slug,
    gameId: Number.isFinite(gameId) ? gameId : null,
  };
}

/** 写入进程内 Gamma 索引，避免重复 API 请求 */
export function rememberGammaEvent(gammaIndex, row) {
  if (!row || !gammaIndex)
    return;
  if (row.slug)
    gammaIndex.bySlug.set(row.slug, row);
  if (row.id)
    gammaIndex.bySlug.set(row.id, row);
  if (Number.isFinite(row.gameId))
    gammaIndex.byGameId.set(row.gameId, { id: row.id, slug: row.slug });
}

/**
 * @returns {Promise<{ byGameId: Map<number, { id: string, slug: string }>, bySlug: Map<string, { id: string, slug: string, gameId: number | null }> }>}
 */
export async function refreshGammaEventIndex() {
  const byGameId = new Map();
  const bySlug = new Map();
  const seriesIds = await fetchEsportsSeriesIds();
  let cursor = "";

  for (let page = 0; page < MAX_KEYSET_PAGES; page += 1) {
    const now = Date.now();
    const params = new URLSearchParams({
      closed: "false",
      limit: String(KEYSET_PAGE_LIMIT),
      order: "startTime",
      ascending: "true",
      start_time_min: new Date(now - COLLECT_PAST_MS).toISOString(),
      start_time_max: new Date(now + COLLECT_FUTURE_MS).toISOString(),
    });
    for (const id of seriesIds)
      params.append("series_id", id);
    if (cursor)
      params.set("after_cursor", cursor);

    const data = await fetchJson(`${POLYMARKET_GAMMA_API}/events/keyset?${params.toString()}`);
    const events = unwrapEvents(data);
    for (const event of events) {
      const row = gammaEventRowFromApi(event);
      if (!row)
        continue;
      if (row.slug)
        bySlug.set(row.slug, row);
      if (row.id)
        bySlug.set(row.id, row);
      if (Number.isFinite(row.gameId))
        byGameId.set(row.gameId, { id: row.id, slug: row.slug });
    }
    cursor = nextCursor(data);
    if (!cursor)
      break;
  }

  return { byGameId, bySlug };
}

/** Gamma 单条 gameId 查询（WS 常无 slug，keyset 也可能未收录） */
export async function fetchGammaEventByGameId(gameId) {
  const id = Number(gameId);
  if (!Number.isFinite(id) || id <= 0)
    return null;
  try {
    const params = new URLSearchParams({
      game_id: String(id),
      limit: "1",
      closed: "false",
    });
    const data = await fetchJson(`${POLYMARKET_GAMMA_API}/events?${params.toString()}`);
    let event = unwrapEvents(data)[0];
    if (event) {
      const gid = event?.gameId != null ? Number(event.gameId) : null;
      if (gid !== id)
        event = null;
    }
    if (!event) {
      const mParams = new URLSearchParams({ game_id: String(id), limit: "1" });
      const mData = await fetchJson(`${POLYMARKET_GAMMA_API}/markets?${mParams.toString()}`);
      const market = unwrapEvents(mData)[0];
      if (market?.events?.[0])
        event = market.events[0];
      else if (market?.event)
        event = market.event;
      if (event) {
        const gid = event?.gameId != null ? Number(event.gameId) : null;
        if (gid !== id)
          event = null;
      }
    }
    return gammaEventRowFromApi(event);
  }
  catch (err) {
    console.warn("[pm-sports] Gamma event by gameId failed:", err.message);
    return null;
  }
}

/** GET /events/{id} — 轮询已关联 PM 场时用 */
export async function fetchGammaEventById(eventId) {
  const id = String(eventId || "").trim();
  if (!id)
    return null;
  try {
    const data = await fetchJson(`${POLYMARKET_GAMMA_API}/events/${encodeURIComponent(id)}`);
    if (!data || typeof data !== "object")
      return null;
    return data;
  }
  catch (err) {
    console.warn(`[pm-sports] Gamma event ${id} failed:`, err.message);
    return null;
  }
}

/** @param {string | undefined} title */
export function parseTeamsFromGammaTitle(title) {
  const raw = String(title || "").trim();
  const m = /:\s*(.+?)\s+vs\s+(.+?)\s+\(/i.exec(raw);
  if (!m)
    return { home: "", away: "" };
  return { home: m[1].trim(), away: m[2].trim() };
}

/** Gamma event → Sports WS 消息形状（供 parse_sport 复用） */
export function gammaEventToSportMessage(event, teams = {}) {
  if (!event || typeof event !== "object")
    return null;
  const home = String(teams.home || "").trim();
  const away = String(teams.away || "").trim();
  const parsed = parseTeamsFromGammaTitle(event.title);
  const live = event.live === true;
  const ended = event.ended === true;
  // [changmen 扩展] 仅明确的状态/布尔字段可用于补充；缺值不推断未开赛。
  const status = String(event.status ?? "").trim() || (ended
    ? "finished"
    : live
      ? "running"
      : event.live === false && event.ended === false ? "not_started" : "");
  const homeTeam = home || parsed.home;
  const awayTeam = away || parsed.away;
  const gameId = event.gameId != null ? Number(event.gameId) : undefined;
  return {
    gameId: Number.isFinite(gameId) ? gameId : undefined,
    slug: event.slug ? String(event.slug) : undefined,
    eventId: event.id != null ? String(event.id) : undefined,
    homeTeam,
    awayTeam,
    status,
    live,
    ended,
    score: event.score ? String(event.score) : undefined,
    period: event.period ? String(event.period) : undefined,
    elapsed: event.elapsed != null ? String(event.elapsed) : undefined,
    resolutionSource: event.resolutionSource ? String(event.resolutionSource) : undefined,
  };
}

/** Gamma 单条 slug 查询（keyset 索引未覆盖时的兜底） */
export async function fetchGammaEventBySlug(slug) {
  const s = String(slug || "").trim();
  if (!s)
    return null;
  try {
    const params = new URLSearchParams({ slug: s, limit: "1" });
    const data = await fetchJson(`${POLYMARKET_GAMMA_API}/events?${params.toString()}`);
    const events = unwrapEvents(data);
    const event = events[0];
    if (!event)
      return null;
    return gammaEventRowFromApi(event);
  }
  catch (err) {
    console.warn("[pm-sports] Gamma event by slug failed:", err.message);
    return null;
  }
}
