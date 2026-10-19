import type { CollectMatchDto, CollectBetDto, CollectTeamDto } from "@changmen/client-core/types/collect";
import type { PlatformId } from "@changmen/api-contract";
import { PLATFORMS } from "../shared/platforms";

const PLATFORM: PlatformId = PLATFORMS.Dex;

/** DexSport Sportsbook API 基础地址 */
export const DEX_SPORTSBOOK_BASE = "https://prod.dexsport.work";
export const DEX_SPORTSBOOK_API = `${DEX_SPORTSBOOK_BASE}/api/sportsbook`;
export const DEX_LINE_API = `${DEX_SPORTSBOOK_BASE}/api/line`;
export const DEX_CONTENT_API = `${DEX_SPORTSBOOK_BASE}/api/content`;
export const DEX_CID = "ta-dexsport";

/** DexSport 电竞 discipline slugs → changmen SourceGameID */
export const DEX_ESPORT_SLUGS: Record<string, string> = {
  dota2: "dota2",
  csgo: "csgo",
  lol: "lol",
  valorant: "valorant",
  "king-of-glory": "king-of-glory",
};

export function dexSportSlugs(): string[] {
  return Object.keys(DEX_ESPORT_SLUGS);
}

export interface DexEvent {
  id: string;
  slug: string;
  status: string;
  startTime: number;
  home: string;
  away: string;
  homeId: string;
  awayId: string;
  disciplineSlug: string;
}

export interface DexMarket {
  id: string;
  name: string;
  status: string;
  outcomes: Array<{
    id: string;
    name: string;
    odds: number;
    status: string;
  }>;
}

/** 解析 /api/line/top-events/{slug} 响应 */
export function parseTopEvents(
  disciplineSlug: string,
  data: unknown,
): DexEvent[] {
  const events: DexEvent[] = [];
  const wrapper = data as { data?: unknown } | unknown[] | undefined;
  const list = Array.isArray(wrapper) ? wrapper
    : Array.isArray((wrapper as Record<string, unknown>)?.data) ? (wrapper as Record<string, unknown>).data as unknown[]
    : [];

  for (const ev of list) {
    if (!ev || typeof ev !== "object") continue;
    const raw = ev as Record<string, unknown>;

    const competitors = (raw.competitors ?? []) as Array<Record<string, unknown>>;
    if (competitors.length < 2) continue;

    const home = competitors[0]!;
    const away = competitors[1]!;
    const homeName = String(home.name ?? "");
    const awayName = String(away.name ?? "");
    if (!homeName || !awayName) continue;

    const startTime = Number(raw.startTime ?? 0);

    events.push({
      id: String(raw.id ?? ""),
      slug: String(raw.slug ?? ""),
      status: String(raw.status ?? ""),
      startTime: startTime > 1e12 ? startTime : startTime * 1000,
      home: homeName,
      away: awayName,
      homeId: String(home.id ?? home.identity ?? ""),
      awayId: String(away.id ?? away.identity ?? ""),
      disciplineSlug,
    });
  }
  return events;
}

export function dexEventToMatch(ev: DexEvent): CollectMatchDto {
  const gameId = DEX_ESPORT_SLUGS[ev.disciplineSlug] || ev.disciplineSlug;
  const teamHome: CollectTeamDto = {
    Type: PLATFORM,
    TeamID: ev.homeId,
    Name: ev.home,
    GameID: gameId,
    Logo: "",
  };
  const teamAway: CollectTeamDto = {
    Type: PLATFORM,
    TeamID: ev.awayId,
    Name: ev.away,
    GameID: gameId,
    Logo: "",
  };
  return {
    Type: PLATFORM,
    SourceMatchID: ev.id,
    SourceGameID: gameId,
    StartTime: ev.startTime,
    HomeID: ev.homeId,
    Home: ev.home,
    AwayID: ev.awayId,
    Away: ev.away,
    Teams: [teamHome, teamAway],
  };
}

/** 从 top-events 内嵌的 markets 解析赔率 */
export function parseInlineMarkets(
  matchId: string,
  markets: unknown[],
): CollectBetDto[] {
  const bets: CollectBetDto[] = [];

  for (const mkt of markets) {
    if (!mkt || typeof mkt !== "object") continue;
    const raw = mkt as Record<string, unknown>;
    const outcomes = (raw.outcomes ?? []) as Array<Record<string, unknown>>;
    if (outcomes.length !== 2) continue;

    const name = String(raw.name ?? raw.identity ?? "");
    const map = parseMapFromMarketName(name);

    const home = outcomes[0]!;
    const away = outcomes[1]!;
    const homeFrozen = Boolean(home.isFrozen);
    const awayFrozen = Boolean(away.isFrozen);
    const homeOdds = !homeFrozen ? Number(home.price ?? 0) : 0;
    const awayOdds = !awayFrozen ? Number(away.price ?? 0) : 0;

    bets.push({
      Type: PLATFORM,
      SourceMatchID: matchId,
      Map: map,
      SourceBetID: String(raw.id ?? ""),
      BetName: name,
      SourceHomeID: String(home.id ?? ""),
      HomeName: String(home.name ?? ""),
      HomeOdds: homeOdds,
      SourceAwayID: String(away.id ?? ""),
      AwayName: String(away.name ?? ""),
      AwayOdds: awayOdds,
      Status: homeFrozen && awayFrozen ? "Locked" : "Normal",
    });
  }
  return bets;
}

export function parseMapFromMarketName(name: string): number {
  const lower = name.toLowerCase();
  const mapMatch = /map\s*(\d)\b/.exec(lower);
  if (mapMatch) return Number(mapMatch[1]);
  const cnMatch = /(\d)\s*号地图|地图\s*(\d)/.exec(name);
  if (cnMatch) return Number(cnMatch[1] || cnMatch[2]);
  if (/match\s*winner|比赛赢家|比赛获胜/i.test(name)) return 0;
  return 0;
}
