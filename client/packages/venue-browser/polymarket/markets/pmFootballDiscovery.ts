/** 足球专用 PM discovery：浏览器直连官方 Gamma/CLOB；不复用或修改电竞 collector。 */
import type { BetRowDto, ClientMatchDto } from "@changmen/client-core/types/esport";
import { directGet, directPostJson } from "@changmen/client-core/shared/http";
import { POLYMARKET_CLOB_API, POLYMARKET_GAMMA_API } from "../api";

const PAGE_LIMIT = 200;
const MAX_PAGES = 8;
const FUTURE_MS = 6 * 3_600_000;
const PAST_MS = 4 * 3_600_000;
const CACHE_MS = 30_000;
const FOOTBALL_TAG_ID = "100350";
const LEAGUES = new Set([
  "epl",
  "lal",
  "bun",
  "fl1",
  "sea",
  "ucl",
  "uel",
  "uecl",
  "mls",
  "ere",
  "por",
  "uef",
  "fif",
  "mex",
  "bra",
  "arg",
  "copa",
  "jap",
  "afc",
  "caf",
  "chi",
  "chi2",
]);
const LEAGUE_ALIASES: Record<string, string> = { col: "uecl", copaam: "copa" };
const SIBLING_RE = /\s+-\s+(More Markets|Total Corners|Exact Score|Halftime Result|Second Half Result|First Team to Score|Team Totals?|Corners)\s*$/i;

type JsonRow = Record<string, any>;
interface Http {
  get: <T>(url: string) => Promise<T>;
  post: <T>(url: string, body: unknown) => Promise<T>;
}

let cache: { at: number; rows: ClientMatchDto[] } | null = null;

function arrayValue(value: unknown): string[] {
  if (Array.isArray(value))
    return value.map(String);
  if (typeof value !== "string" || !value.trim())
    return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  }
  catch { return []; }
}

function startMs(row: JsonRow): number {
  const raw = row.startTime ?? row.startDate;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0)
    return n > 1e12 ? n : n * 1000;
  const parsed = Date.parse(String(raw ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function stableId(value: unknown): number {
  let hash = 0;
  for (const c of String(value ?? "")) hash = ((hash << 5) - hash + c.charCodeAt(0)) | 0;
  return 800_000_000 + ((Math.abs(hash) || 1) % 99_000_000);
}

function cloneRows(rows: ClientMatchDto[]): ClientMatchDto[] {
  return rows.map(row => ({
    ...row,
    Matchs: { ...(row.Matchs || {}) },
    Bets: (row.Bets || []).map(bet => ({
      ...bet,
      Sources: Object.fromEntries(
        Object.entries(bet.Sources || {}).map(([venue, source]) => [venue, { ...source }]),
      ),
    })),
  }));
}

function baseTitle(title: string): string {
  return title.replace(SIBLING_RE, "").trim();
}

function teams(title: string): { home: string; away: string } | null {
  const parts = baseTitle(title).replace(/\s*\([+-]?\d+(?:\.\d+)?\)\s*/g, " ").split(/\s+vs\.?\s+/i);
  if (parts.length < 2)
    return null;
  const home = parts[0]?.trim() ?? "";
  const away = parts.slice(1).join(" vs ").trim();
  return home && away ? { home, away } : null;
}

function gameCode(row: JsonRow): string {
  const candidates = [row.sport?.sport, row.seriesSlug, ...(Array.isArray(row.series) ? row.series.map((x: JsonRow) => x.ticker ?? x.slug) : [])];
  for (const raw of candidates) {
    const key = String(raw ?? "").toLowerCase().trim();
    const mapped = LEAGUE_ALIASES[key] ?? key;
    if (LEAGUES.has(mapped))
      return mapped;
  }
  return "unknown_fb";
}

function leagueName(row: JsonRow): string {
  const series = Array.isArray(row.series) ? row.series : [];
  return String(series.find((x: JsonRow) => x?.title || x?.name)?.title ?? series.find((x: JsonRow) => x?.title || x?.name)?.name ?? "").trim();
}

function lineOf(row: JsonRow): number | null {
  const direct = Number(row.line ?? row.spread);
  if (Number.isFinite(direct))
    return direct;
  const match = String(row.groupItemTitle ?? row.question ?? "").match(/([+-]?\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

function probabilityOdds(value: unknown): number {
  const n = Number(value);
  return n > 0 && n < 1 ? Math.round((1 / n) * 1000) / 1000 : 0;
}

function isOpen(row: JsonRow): boolean {
  return row.active !== false && !row.closed && row.accepting_orders !== false && row.acceptingOrders !== false;
}

function sameLabel(value: string, label: string): boolean {
  const a = value.toLowerCase();
  const b = label.toLowerCase();
  const last = b.split(/\s+/).pop() ?? "";
  return Boolean(a && b && (a.includes(b) || b.includes(a) || (last.length > 2 && a.includes(last))));
}

function makeBet(matchId: number, seq: number, code: string, line: number | null, names: string[], tokens: string[], prices: number[], sourceId: string): BetRowDto {
  const betId = matchId * 100 + seq;
  return {
    ID: betId,
    MatchID: matchId,
    Map: 0,
    Name: code === "moneyline" ? "胜负" : code === "spreads" ? `让球 ${line}` : `大小 ${line}`,
    MarketCode: code,
    Line: line,
    HomeID: betId * 10 + 1,
    HomeName: names[0] ?? "Home",
    AwayID: betId * 10 + 2,
    AwayName: names[1] ?? "Away",
    Sources: {
      Polymarket: {
        Type: "Polymarket",
        BetID: sourceId,
        HomeID: tokens[0] ?? `${sourceId}-home`,
        AwayID: tokens[1] ?? `${sourceId}-away`,
        HomeOdds: probabilityOdds(prices[0]),
        AwayOdds: probabilityOdds(prices[1]),
        Status: "Normal",
      },
    },
  };
}

function orient(row: JsonRow, home: string, away: string, live: Record<string, number>, totals = false) {
  const outcomes = arrayValue(row.outcomes);
  const tokens = arrayValue(row.clobTokenIds ?? row.clob_token_ids);
  const snapshots = arrayValue(row.outcomePrices ?? row.outcome_prices).map(Number);
  let homeIndex = 0;
  if (totals) {
    if (/^(?:under|u)/i.test(outcomes[0] ?? "") || /^(?:over|o)/i.test(outcomes[1] ?? ""))
      homeIndex = 1;
  }
  else if (sameLabel(outcomes[1] ?? "", home) || sameLabel(outcomes[0] ?? "", away)) {
    homeIndex = 1;
  }
  const awayIndex = homeIndex === 0 ? 1 : 0;
  return {
    names: totals ? ["大", "小"] : [home, away],
    tokens: [tokens[homeIndex] ?? "", tokens[awayIndex] ?? ""],
    prices: [live[tokens[homeIndex] ?? ""] ?? snapshots[homeIndex] ?? 0, live[tokens[awayIndex] ?? ""] ?? snapshots[awayIndex] ?? 0],
  };
}

function unwrapEvents(data: any): JsonRow[] {
  return Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : Array.isArray(data?.events) ? data.events : [];
}

export async function fetchPmFootballDirect(http: Http = {
  get: url => directGet(url, {}),
  post: (url, body) => directPostJson(url, {}, body),
}): Promise<ClientMatchDto[]> {
  if (cache && Date.now() - cache.at < CACHE_MS)
    return cloneRows(cache.rows);
  const now = Date.now();
  const rawEvents: JsonRow[] = [];
  let cursor = "";
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params = new URLSearchParams({
      closed: "false",
      limit: String(PAGE_LIMIT),
      order: "startTime",
      ascending: "true",
      start_time_min: new Date(now - PAST_MS).toISOString(),
      start_time_max: new Date(now + FUTURE_MS).toISOString(),
      tag_id: FOOTBALL_TAG_ID,
    });
    if (cursor)
      params.set("after_cursor", cursor);
    const data = await http.get<any>(`${POLYMARKET_GAMMA_API}/events/keyset?${params}`);
    rawEvents.push(...unwrapEvents(data));
    cursor = String(data?.next_cursor ?? data?.nextCursor ?? "");
    if (!cursor)
      break;
  }

  const groups = new Map<string, { id: string; title: string; start: number; game: string; league: string; markets: JsonRow[] }>();
  for (const event of rawEvents) {
    const title = String(event.title ?? "").trim();
    const start = startMs(event);
    if (!title || !start || start < now - PAST_MS || start > now + FUTURE_MS)
      continue;
    const key = `${gameCode(event)}|${baseTitle(title).toLowerCase()}|${Math.floor(start / 3_600_000)}`;
    const group = groups.get(key) ?? { id: String(event.id ?? event.slug ?? key), title: baseTitle(title), start, game: gameCode(event), league: leagueName(event), markets: [] };
    for (const market of Array.isArray(event.markets) ? event.markets : []) {
      const code = String(market.sportsMarketType ?? market.sports_market_type ?? "").toLowerCase();
      if (isOpen(market) && (code === "moneyline" || code === "spreads" || code === "totals"))
        group.markets.push({ ...market, _code: code });
    }
    if (!SIBLING_RE.test(title) && group.markets.some(m => m._code === "moneyline")) {
      group.id = String(event.id ?? event.slug ?? key);
      group.title = baseTitle(title);
      group.start = start;
    }
    groups.set(key, group);
  }

  const tokenIds = [...new Set([...groups.values()].flatMap(g => g.markets.flatMap(m => arrayValue(m.clobTokenIds ?? m.clob_token_ids))))].slice(0, 400);
  let live: Record<string, number> = {};
  if (tokenIds.length) {
    try {
      const prices = await http.post<Record<string, { SELL?: number }>>(`${POLYMARKET_CLOB_API}/prices`, tokenIds.map(token_id => ({ token_id, side: "SELL" })));
      live = Object.fromEntries(Object.entries(prices ?? {}).map(([id, sides]) => [id, Number(sides?.SELL) || 0]));
    }
    catch { /* Gamma outcomePrices remains usable */ }
  }

  const rows: ClientMatchDto[] = [];
  for (const group of groups.values()) {
    const pair = teams(group.title);
    if (!pair)
      continue;
    const matchId = stableId(group.id);
    const bets: BetRowDto[] = [];
    let seq = 0;
    for (const market of group.markets) {
      const code = String(market._code);
      const line = code === "moneyline" ? null : lineOf(market);
      if (code !== "moneyline" && line == null)
        continue;
      const oriented = orient(market, pair.home, pair.away, live, code === "totals");
      bets.push(makeBet(matchId, ++seq, code, line, oriented.names, oriented.tokens, oriented.prices, String(market.conditionId ?? market.condition_id ?? market.id ?? group.id)));
    }
    if (!bets.some(b => b.MarketCode === "moneyline"))
      continue;
    rows.push({ ID: matchId, Title: group.title, Game: group.game, GameID: 0, StartTime: group.start, ...(group.league ? { League: group.league } : {}), Matchs: { Polymarket: group.id }, Bets: bets });
  }
  rows.sort((a, b) => a.StartTime - b.StartTime);
  cache = { at: Date.now(), rows: cloneRows(rows) };
  return cloneRows(rows);
}

export function clearPmFootballDirectCache(): void {
  cache = null;
}
