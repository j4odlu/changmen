import type { CollectBetDto, CollectMatchDto, CollectTeamDto } from "@changmen/client-core/types/collect";
import type { PlatformId } from "@changmen/api-contract";
import { truncateOddsTo3 } from "@changmen/shared/odds_format";
import { PLATFORMS } from "../shared/platforms";

const PLATFORM: PlatformId = PLATFORMS.Limitless;

export interface LimitlessTradePrices {
  buy?: { market?: number[]; limit?: number[] };
  sell?: { market?: number[]; limit?: number[] };
}

export interface LimitlessSubMarket {
  id?: number;
  slug?: string;
  title?: string;
  status?: string;
  expired?: boolean;
  tokens?: { yes?: string; no?: string };
  prices?: number[];
  tradePrices?: LimitlessTradePrices;
}

export interface LimitlessGroupMetadata {
  homeTeam?: string;
  awayTeam?: string;
  esportTitle?: string;
  marketType?: string;
  startMatchTimestampInUTC?: number;
  externalMatchId?: number;
  leagueName?: string;
}

export interface LimitlessGroupMarket {
  id?: number;
  slug?: string;
  title?: string;
  marketType?: string;
  status?: string;
  expired?: boolean;
  tradeType?: string;
  markets?: LimitlessSubMarket[];
  metadata?: LimitlessGroupMetadata;
}

export interface LimitlessOrderbook {
  bids?: Array<{ price?: number; size?: number }>;
  asks?: Array<{ price?: number; size?: number }>;
}

export interface LimitlessMappedMarket {
  match: CollectMatchDto;
  bet: CollectBetDto;
  /** 子市场 slug → YES token id */
  slugToTokenId: Record<string, string>;
  homeSlug: string;
  awaySlug: string;
  marketId: string;
}

const SUPPORTED_ESPORT_TITLES = new Set(["cs2", "lol", "league-of-legends", "dota-2", "dota2", "valorant"]);

export function mapLimitlessEsportTitle(title: string | undefined): string | null {
  const raw = String(title ?? "").trim().toLowerCase();
  if (!raw)
    return null;
  // 官网/API 现多用 cs-go；旧样本偶见 cs2 / counter-strike-2
  if (
    raw === "cs2"
    || raw === "cs-go"
    || raw === "csgo"
    || raw === "counter-strike"
    || raw === "counter-strike-2"
    || raw === "counter strike"
    || raw === "counter strike 2"
  )
    return "cs2";
  if (raw === "lol" || raw === "league-of-legends")
    return "lol";
  if (raw === "dota-2" || raw === "dota2")
    return "dota2";
  if (raw === "valorant")
    return "valorant";
  return SUPPORTED_ESPORT_TITLES.has(raw) ? raw : null;
}

export function isLimitlessEsportsMatchWinnerGroup(group: LimitlessGroupMarket): boolean {
  if (group.marketType !== "group" || group.expired || group.status !== "FUNDED")
    return false;
  if (group.tradeType && group.tradeType !== "clob")
    return false;
  const meta = group.metadata;
  if (!meta || meta.marketType !== "match_winner")
    return false;
  if (!mapLimitlessEsportTitle(meta.esportTitle))
    return false;
  if (!meta.homeTeam || !meta.awayTeam)
    return false;
  return Array.isArray(group.markets) && group.markets.length >= 2;
}

export function normalizeLimitlessTeamName(name: string): string {
  const normalized = String(name || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\u4E00-\u9FFF]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "unknown";
}

export function sourceTeamId(gameId: string, name: string): string {
  return `${gameId}:${normalizeLimitlessTeamName(name)}`;
}

function normalizeTeamTitle(name: string | undefined): string {
  return String(name ?? "").trim().toLowerCase();
}

function findTeamSubMarket(markets: LimitlessSubMarket[], teamName: string): LimitlessSubMarket | undefined {
  const target = normalizeTeamTitle(teamName);
  return markets.find((row) => {
    const title = normalizeTeamTitle(row.title);
    return title && title === target && title !== "draw" && !row.expired && row.status === "FUNDED";
  });
}

export function decimalOddsFromProbability(price: string | number | undefined): number {
  const value = Number(price);
  if (!Number.isFinite(value) || value <= 0 || value >= 1)
    return 0;
  return truncateOddsTo3(1 / value);
}

export function bestAskFromBook(book: LimitlessOrderbook | undefined): number {
  const asks = book?.asks ?? [];
  let best = Number.POSITIVE_INFINITY;
  for (const level of asks) {
    const price = Number(level.price);
    const size = Number(level.size);
    if (Number.isFinite(price) && price > 0 && price < best && (!Number.isFinite(size) || size > 0))
      best = price;
  }
  return Number.isFinite(best) ? best : 0;
}

function buyYesProbability(sub: LimitlessSubMarket, orderbook?: LimitlessOrderbook | null): number {
  const fromBook = bestAskFromBook(orderbook ?? undefined);
  if (fromBook > 0 && fromBook < 1)
    return fromBook;
  const buyMarket = sub.tradePrices?.buy?.market?.[0];
  if (Number.isFinite(buyMarket) && buyMarket! > 0 && buyMarket! < 1)
    return buyMarket!;
  const mid = sub.prices?.[0];
  if (Number.isFinite(mid) && mid! > 0 && mid! < 1)
    return mid!;
  return 0;
}

function startTimeOf(meta: LimitlessGroupMetadata | undefined): number {
  const sec = Number(meta?.startMatchTimestampInUTC ?? 0);
  if (Number.isFinite(sec) && sec > 0)
    return sec * 1000;
  return Date.now();
}

/**
 * NegRisk 电竞组：home/away 各一个子市场，YES token 即该队获胜盘口。
 * `buyPrices` 可选 slug → 买入 YES 的概率价（orderbook best ask）。
 */
export function buildLimitlessMappedMarket(
  group: LimitlessGroupMarket,
  buyPrices: Record<string, number> = {},
): LimitlessMappedMarket | null {
  if (!isLimitlessEsportsMatchWinnerGroup(group))
    return null;

  const meta = group.metadata!;
  const gameId = mapLimitlessEsportTitle(meta.esportTitle);
  if (!gameId)
    return null;

  const homeSub = findTeamSubMarket(group.markets!, meta.homeTeam!);
  const awaySub = findTeamSubMarket(group.markets!, meta.awayTeam!);
  if (!homeSub?.slug || !awaySub?.slug)
    return null;

  const homeTokenId = String(homeSub.tokens?.yes ?? "");
  const awayTokenId = String(awaySub.tokens?.yes ?? "");
  if (!homeTokenId || !awayTokenId)
    return null;

  const marketId = String(group.slug ?? group.id ?? "");
  const sourceMatchId = String(group.id ?? group.slug ?? marketId);
  if (!marketId)
    return null;

  const homeName = String(meta.homeTeam);
  const awayName = String(meta.awayTeam);
  const matchHomeId = sourceTeamId(gameId, homeName);
  const matchAwayId = sourceTeamId(gameId, awayName);
  const startTime = startTimeOf(meta);

  const homeProb = buyPrices[homeSub.slug] ?? buyYesProbability(homeSub);
  const awayProb = buyPrices[awaySub.slug] ?? buyYesProbability(awaySub);
  const homeOdds = decimalOddsFromProbability(homeProb);
  const awayOdds = decimalOddsFromProbability(awayProb);
  const locked = !homeOdds || !awayOdds;

  const homeTeam: CollectTeamDto = {
    Type: PLATFORM,
    TeamID: matchHomeId,
    Name: homeName,
    GameID: gameId,
    Logo: "",
  };
  const awayTeam: CollectTeamDto = {
    Type: PLATFORM,
    TeamID: matchAwayId,
    Name: awayName,
    GameID: gameId,
    Logo: "",
  };

  return {
    marketId,
    homeSlug: homeSub.slug,
    awaySlug: awaySub.slug,
    slugToTokenId: {
      [homeSub.slug]: homeTokenId,
      [awaySub.slug]: awayTokenId,
    },
    match: {
      Type: PLATFORM,
      SourceMatchID: sourceMatchId,
      SourceGameID: gameId,
      StartTime: startTime,
      HomeID: matchHomeId,
      Home: homeName,
      AwayID: matchAwayId,
      Away: awayName,
      Teams: [homeTeam, awayTeam],
    },
    bet: {
      Type: PLATFORM,
      SourceMatchID: sourceMatchId,
      SourceBetID: marketId,
      Map: 0,
      BetName: "[全场] 获胜者",
      SourceHomeID: homeTokenId,
      HomeName: homeName,
      HomeOdds: homeOdds,
      SourceAwayID: awayTokenId,
      AwayName: awayName,
      AwayOdds: awayOdds,
      Status: locked ? "Locked" : "Normal",
    },
  };
}
