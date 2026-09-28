import type { BetRowDto, ClientMatchDto } from "@changmen/client-core/types/esport";
import type { CollectPlatformInfo } from "@changmen/api-contract";
import { RAY_A8_COLLECT } from "./a8Collect";
import { collectRayGet } from "./markets";

export const RAY_FOOTBALL_GAME_ID = "885709";
const MATCH_TYPES = [1, 2, 3] as const;
const PAGE_SIZE = 30;
const MAX_PAGES = 8;
const UPCOMING_MS = 2 * 60 * 60 * 1000;
const LIVE_LOOKBACK_MS = 4 * 60 * 60 * 1000;
const CACHE_MS = 7_000;

type JsonRow = Record<string, unknown>;
type RayFootballTeam = {
  pos?: number;
  team_id?: string | number;
  team_name?: string;
  team_short_name?: string;
};

let cache: { at: number; rows: ClientMatchDto[] } | null = null;
let inflight: Promise<ClientMatchDto[]> | null = null;

function collectPlatform(): CollectPlatformInfo {
  return {
    Gateway: RAY_A8_COLLECT.gateway,
    Token: RAY_A8_COLLECT.token,
    BetName: RAY_A8_COLLECT.betName,
  };
}

function startTimeMs(value: unknown): number {
  const ms = new Date(String(value || "")).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function lineValue(value: unknown): number | null {
  const matches = String(value ?? "").match(/[-+]?\d+(?:\.\d+)?/g);
  if (!matches?.length)
    return null;
  const n = Number(matches[matches.length - 1]);
  return Number.isFinite(n) ? n : null;
}

function rowOdds(row: JsonRow): number {
  return Number(row.status) === 1 ? Number(row.odds) || 0 : 0;
}

function oddId(row: JsonRow): string {
  return String(row.odds_id ?? row.id ?? "").trim();
}

function isDraw(row: JsonRow): boolean {
  return String(row.value || "").toLowerCase() === "draw"
    || /^(?:平|和局|draw)$/i.test(String(row.name || "").trim());
}

function makeBet(
  matchId: number,
  seq: number,
  code: string,
  line: number | null,
  home: string,
  away: string,
  group: JsonRow[],
  homeTeamId: string,
  awayTeamId: string,
): BetRowDto | null {
  const isTotals = code === "totals" || code === "ht_totals";
  let homeRow: JsonRow | undefined;
  let awayRow: JsonRow | undefined;
  let drawRow: JsonRow | undefined;

  if (isTotals) {
    homeRow = group.find(row => /^>|大于|^over/i.test(String(row.value || row.name || "")));
    awayRow = group.find(row => /^<|小于|^under/i.test(String(row.value || row.name || "")));
  }
  else {
    homeRow = group.find(row => String(row.team_id ?? "") === homeTeamId);
    awayRow = group.find(row => String(row.team_id ?? "") === awayTeamId);
    drawRow = group.find(isDraw);
  }

  if (!homeRow || !awayRow)
    return null;
  const homeOdd = rowOdds(homeRow);
  const awayOdd = rowOdds(awayRow);
  const drawOdd = drawRow ? rowOdds(drawRow) : 0;
  const betId = matchId * 100 + seq;
  const source: BetRowDto["Sources"][string] = {
    Type: "RAY",
    BetID: String(homeRow.odds_group_id ?? awayRow.odds_group_id ?? ""),
    HomeID: oddId(homeRow),
    AwayID: oddId(awayRow),
    HomeOdds: homeOdd,
    AwayOdds: awayOdd,
    Status: homeOdd > 0 && awayOdd > 0 ? "Normal" : "Locked",
  };
  if (drawRow) {
    source.DrawID = oddId(drawRow);
    source.DrawOdds = drawOdd;
    if (!(drawOdd > 0))
      source.Status = "Locked";
  }
  const half = code.startsWith("ht_");
  const name = code.endsWith("moneyline")
    ? `${half ? "半场" : "全场"}独赢`
    : code.endsWith("spreads")
      ? `${half ? "半场" : "全场"}让球${line == null ? "" : ` ${line}`}`
      : `${half ? "半场" : "全场"}大小${line == null ? "" : ` ${line}`}`;
  return {
    ID: betId,
    MatchID: matchId,
    Map: 0,
    Name: name,
    MarketCode: code,
    Line: line,
    HomeID: betId * 10 + 1,
    HomeName: isTotals ? "大" : home,
    AwayID: betId * 10 + 2,
    AwayName: isTotals ? "小" : away,
    Sources: { RAY: source },
  };
}

/** RAY Soccer 详情的标准盘 → 足球页 DTO；不写电竞 fo / platform_*。 */
export function rayFootballRowToClientMatchDto(row: JsonRow): ClientMatchDto | null {
  if (String(row.game_id ?? "") !== RAY_FOOTBALL_GAME_ID)
    return null;
  const teams = Array.isArray(row.team) ? row.team as RayFootballTeam[] : [];
  const homeTeam = teams.find(team => Number(team.pos) === 1);
  const awayTeam = teams.find(team => Number(team.pos) === 2);
  if (!homeTeam || !awayTeam || teams.length !== 2)
    return null;
  const sourceId = String(row.id ?? "").trim();
  const matchId = Number(sourceId);
  if (!sourceId || !Number.isSafeInteger(matchId) || matchId <= 0)
    return null;

  const home = String(homeTeam.team_short_name || homeTeam.team_name || "主队").trim();
  const away = String(awayTeam.team_short_name || awayTeam.team_name || "客队").trim();
  const homeTeamId = String(homeTeam.team_id ?? "");
  const awayTeamId = String(awayTeam.team_id ?? "");
  const odds = Array.isArray(row.odds) ? row.odds as JsonRow[] : [];
  const groups = new Map<string, { code: string; line: number | null; rows: JsonRow[] }>();

  for (const odd of odds) {
    const tag = String(odd.tag || "").toLowerCase();
    if (!['wdl', 'hdp', 'ou'].includes(tag))
      continue;
    const stage = String(odd.match_stage || "final").toLowerCase();
    if (stage !== "final" && stage !== "1st")
      continue;
    const half = stage === "1st";
    const code = tag === "wdl"
      ? (half ? "ht_moneyline" : "moneyline")
      : tag === "hdp"
        ? (half ? "ht_spreads" : "spreads")
        : (half ? "ht_totals" : "totals");
    const parsedLine = tag === "wdl" ? null : lineValue(odd.value);
    if (tag !== "wdl" && parsedLine == null)
      continue;
    const keyLine = parsedLine == null ? "" : String(Math.abs(parsedLine));
    const key = `${code}|${odd.odds_group_id ?? ""}|${keyLine}`;
    const found = groups.get(key);
    if (found)
      found.rows.push(odd);
    else
      groups.set(key, { code, line: parsedLine, rows: [odd] });
  }

  const bets: BetRowDto[] = [];
  for (const group of groups.values()) {
    let line = group.line;
    if (group.code.endsWith("spreads")) {
      const homeOdd = group.rows.find(odd => String(odd.team_id ?? "") === homeTeamId);
      line = homeOdd ? lineValue(homeOdd.value) : line;
    }
    else if (group.code.endsWith("totals") && line != null) {
      line = Math.abs(line);
    }
    const bet = makeBet(matchId, bets.length + 1, group.code, line, home, away, group.rows, homeTeamId, awayTeamId);
    if (bet)
      bets.push(bet);
  }

  return {
    ID: matchId,
    Title: `${home} vs ${away}`,
    Game: String(row.tournament_short_name || row.tournament_name || "足球").trim(),
    GameID: 0,
    League: String(row.tournament_short_name || row.tournament_name || "").trim() || undefined,
    StartTime: startTimeMs(row.start_time) || Date.now(),
    Matchs: { RAY: sourceId },
    Bets: bets,
  };
}

async function fetchMatchRows(now: number): Promise<JsonRow[]> {
  const platform = collectPlatform();
  const minTime = now - LIVE_LOOKBACK_MS;
  const maxTime = now + UPCOMING_MS;
  const byId = new Map<string, JsonRow>();
  for (const matchType of MATCH_TYPES) {
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const res = await collectRayGet<{ code?: number; result?: JsonRow[] }>(
        platform,
        "match",
        `match_type=${matchType}&page=${page}`,
      );
      const rows = Array.isArray(res.result) ? res.result : [];
      for (const row of rows) {
        const start = startTimeMs(row.start_time);
        if (String(row.game_id ?? "") === RAY_FOOTBALL_GAME_ID && start >= minTime && start <= maxTime)
          byId.set(String(row.id ?? ""), row);
      }
      if (res.code !== 200 || rows.length < PAGE_SIZE)
        break;
      const starts = rows.map(row => startTimeMs(row.start_time)).filter(Boolean);
      if (starts.length && Math.min(...starts) > maxTime)
        break;
    }
  }
  return [...byId.values()];
}

async function doFetch(): Promise<ClientMatchDto[]> {
  const platform = collectPlatform();
  const rows = await fetchMatchRows(Date.now());
  const detailed = await Promise.all(rows.map(async (row) => {
    try {
      const res = await collectRayGet<{ code?: number; result?: JsonRow }>(platform, "odds", `match_id=${row.id}`);
      return res.code === 200 && res.result ? { ...row, ...res.result } : row;
    }
    catch {
      return row;
    }
  }));
  return detailed
    .map(rayFootballRowToClientMatchDto)
    .filter((row): row is ClientMatchDto => Boolean(row))
    .sort((a, b) => a.StartTime - b.StartTime || a.ID - b.ID);
}

export async function fetchRayFootballAsClientMatchDtos(): Promise<ClientMatchDto[]> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS)
    return cache.rows;
  if (inflight)
    return inflight;
  inflight = doFetch().then((rows) => {
    cache = { at: Date.now(), rows };
    return rows;
  }).finally(() => {
    inflight = null;
  });
  return inflight;
}
