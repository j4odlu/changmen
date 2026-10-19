import type { CollectBetDto, CollectMatchDto, CollectTeamDto } from "@changmen/client-core/types/collect";
import type { PlatformId } from "@changmen/api-contract";
import { truncateOddsTo3 } from "@changmen/shared/odds_format";
import { PLATFORMS } from "../shared/platforms";

import { AZURO_ESPORT_SPORT_IDS } from "./api";

const PLATFORM: PlatformId = PLATFORMS.Azuro;

export interface AzuroParticipant {
  name?: string;
  image?: string;
  sortOrder?: number;
}

export interface AzuroOutcome {
  title?: string;
  outcomeId?: string;
  odds?: string | number;
  state?: string;
  hidden?: boolean;
}

export interface AzuroCondition {
  id?: string;
  conditionId?: string;
  state?: string;
  title?: string;
  hidden?: boolean;
  marketId?: number;
  outcomes?: AzuroOutcome[];
  game?: { gameId?: string; sport?: { sportId?: string } };
}

export interface AzuroGame {
  id?: string;
  gameId?: string;
  title?: string;
  startsAt?: string | number;
  state?: string;
  sport?: { sportId?: string; slug?: string; name?: string };
  league?: { name?: string };
  participants?: AzuroParticipant[];
}

export interface AzuroMappedMarket {
  match: CollectMatchDto;
  bet: CollectBetDto;
  conditionId: string;
  homeOutcomeId: string;
  awayOutcomeId: string;
  marketId: string;
}

export function mapAzuroSportId(sportId: string | undefined): string | null {
  const id = String(sportId ?? "").trim();
  return AZURO_ESPORT_SPORT_IDS[id] ?? null;
}

export function mapAzuroSportSlug(slug: string | undefined): string | null {
  const raw = String(slug ?? "").trim().toLowerCase();
  if (!raw)
    return null;
  if (raw === "cs2")
    return "cs2";
  if (raw === "lol")
    return "lol";
  if (raw === "dota-2" || raw === "dota2")
    return "dota2";
  return null;
}

export function resolveAzuroGameCode(game: AzuroGame): string | null {
  return mapAzuroSportId(game.sport?.sportId) ?? mapAzuroSportSlug(game.sport?.slug);
}

export function isAzuroMatchWinnerCondition(condition: AzuroCondition): boolean {
  if (condition.hidden)
    return false;
  if (String(condition.title ?? "").trim() !== "Match Winner")
    return false;
  if (condition.state !== "Active")
    return false;
  const outcomes = (condition.outcomes ?? []).filter(o => o.state === "Active" && !o.hidden);
  return outcomes.length === 2;
}

export function normalizeAzuroTeamName(name: string): string {
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
  return `${gameId}:${normalizeAzuroTeamName(name)}`;
}

export function parseAzuroDecimalOdds(raw: string | number | undefined): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 1)
    return 0;
  return truncateOddsTo3(value);
}

function normalizeTeamTitle(name: string): string {
  return String(name ?? "").trim().toLowerCase();
}

function pickParticipants(game: AzuroGame): { home: AzuroParticipant; away: AzuroParticipant } | null {
  const list = game.participants ?? [];
  if (list.length < 2)
    return null;
  const sorted = [...list].sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0));
  const home = sorted[0];
  const away = sorted[1];
  if (!home?.name || !away?.name)
    return null;
  return { home, away };
}

function matchOutcome(
  outcomes: AzuroOutcome[],
  teamName: string,
): AzuroOutcome | undefined {
  const target = normalizeTeamTitle(teamName);
  return outcomes.find(o => normalizeTeamTitle(o.title ?? "") === target);
}

function startTimeOf(game: AzuroGame): number {
  const sec = Number(game.startsAt ?? 0);
  if (Number.isFinite(sec) && sec > 0)
    return sec * 1000;
  return Date.now();
}

export function buildAzuroMappedMarket(
  game: AzuroGame,
  condition: AzuroCondition,
): AzuroMappedMarket | null {
  if (!isAzuroMatchWinnerCondition(condition))
    return null;

  const gameCode = resolveAzuroGameCode(game);
  if (!gameCode)
    return null;

  const participants = pickParticipants(game);
  if (!participants)
    return null;

  const outcomes = (condition.outcomes ?? []).filter(o => o.state === "Active" && !o.hidden);
  const homeOutcome = matchOutcome(outcomes, participants.home.name!);
  const awayOutcome = matchOutcome(outcomes, participants.away.name!);
  if (!homeOutcome?.outcomeId || !awayOutcome?.outcomeId)
    return null;

  const sourceMatchId = String(game.gameId ?? game.id ?? "");
  const conditionId = String(condition.conditionId ?? condition.id ?? "");
  if (!sourceMatchId || !conditionId)
    return null;

  const homeName = String(participants.home.name);
  const awayName = String(participants.away.name);
  const matchHomeId = sourceTeamId(gameCode, homeName);
  const matchAwayId = sourceTeamId(gameCode, awayName);
  const homeOutcomeId = String(homeOutcome.outcomeId);
  const awayOutcomeId = String(awayOutcome.outcomeId);
  const homeOdds = parseAzuroDecimalOdds(homeOutcome.odds);
  const awayOdds = parseAzuroDecimalOdds(awayOutcome.odds);
  const locked = !homeOdds || !awayOdds;

  const homeTeam: CollectTeamDto = {
    Type: PLATFORM,
    TeamID: matchHomeId,
    Name: homeName,
    GameID: gameCode,
    Logo: String(participants.home.image ?? ""),
  };
  const awayTeam: CollectTeamDto = {
    Type: PLATFORM,
    TeamID: matchAwayId,
    Name: awayName,
    GameID: gameCode,
    Logo: String(participants.away.image ?? ""),
  };

  return {
    conditionId,
    homeOutcomeId,
    awayOutcomeId,
    marketId: conditionId,
    match: {
      Type: PLATFORM,
      SourceMatchID: sourceMatchId,
      SourceGameID: gameCode,
      StartTime: startTimeOf(game),
      HomeID: matchHomeId,
      Home: homeName,
      AwayID: matchAwayId,
      Away: awayName,
      Teams: [homeTeam, awayTeam],
    },
    bet: {
      Type: PLATFORM,
      SourceMatchID: sourceMatchId,
      SourceBetID: conditionId,
      Map: 0,
      BetName: "[全场] 获胜者",
      SourceHomeID: homeOutcomeId,
      HomeName: homeName,
      HomeOdds: homeOdds,
      SourceAwayID: awayOutcomeId,
      AwayName: awayName,
      AwayOdds: awayOdds,
      Status: locked ? "Locked" : "Normal",
    },
  };
}

export function foOutcomeId(conditionId: string, outcomeId: string): string {
  return `${conditionId}:${outcomeId}`;
}
