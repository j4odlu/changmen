import { stakePluginGraphql } from "./pluginApi";
import { applyStakeLiveOdds } from "./liveOdds";
import { parseMapFromMarketName, STAKE_GRAPHQL, STAKE_SPORT_SLUGS } from "./parse";
import type { CollectBetDto, CollectMatchDto, CollectTeamDto } from "@changmen/client-core/types/collect";
import type { PlatformId } from "@changmen/api-contract";
import { PLATFORMS } from "../shared/platforms";

export interface StakeSubscribeRow {
  id: string;
  slug: string;
}

export interface StakeCollectCycleRow {
  match: CollectMatchDto;
  bets: CollectBetDto[];
  subscribe: StakeSubscribeRow;
  ingestMessage: {
    matchId: string;
    bets: Array<{
      betId: string;
      name: string;
      homeId: string;
      awayId: string;
      home: number;
      away: number;
    }>;
  };
}

const PLATFORM: PlatformId = PLATFORMS.Stake;

/** 对齐 A8 bundle `pp` — 按场次合并盘口，缺失盘口赔率清零 */
const betsByMatch = new Map<string, CollectBetDto[]>();

function mergeStakeBets(matchId: string, incoming: CollectBetDto[]): CollectBetDto[] {
  if (!betsByMatch.has(matchId)) {
    betsByMatch.set(matchId, [...incoming]);
    return betsByMatch.get(matchId)!;
  }
  const prev = betsByMatch.get(matchId)!;
  for (const bet of incoming) {
    const idx = prev.findIndex((row) => row.SourceBetID === bet.SourceBetID);
    if (idx === -1) prev.push(bet);
    else prev[idx] = bet;
  }
  for (const row of prev) {
    if (!incoming.some((b) => b.SourceBetID === row.SourceBetID)) {
      row.HomeOdds = 0;
      row.AwayOdds = 0;
    }
  }
  return prev;
}

export function cleanStakeBets(activeMatches: CollectMatchDto[]) {
  const activeIds = new Set(activeMatches.map((m) => String(m.SourceMatchID)));
  for (const matchId of [...betsByMatch.keys()]) {
    if (!activeIds.has(matchId)) betsByMatch.delete(matchId);
  }
}

export function getMergedStakeBets(matchId: string): CollectBetDto[] {
  return betsByMatch.get(matchId) ?? [];
}

const STAKE_COLLECT_HEADERS: Record<string, string> = {
  "content-type": "application/json",
  "x-language": "zh",
  "x-operation-name": "CurrencyConfiguration",
  "x-operation-type": "query",
};

/** 对齐 A8 `eJe` */
export async function fetchStakeSportIndex(
  tabId: number,
  sportSlug: string,
): Promise<Record<string, unknown>> {
  return stakePluginGraphql(
    "SportIndex",
    {
      query: STAKE_GRAPHQL,
      variables: { sport: sportSlug, groups: ["winner", "maps"] },
    },
    { tabId, headers: STAKE_COLLECT_HEADERS },
  );
}

/** 对齐 A8 `XZe` */
export function parseSportIndexResponse(
  sportSlug: string,
  payload: Record<string, unknown>,
): { rows: StakeCollectCycleRow[]; subscribe: StakeSubscribeRow[] } {
  const rows: StakeCollectCycleRow[] = [];
  const subscribe: StakeSubscribeRow[] = [];
  const data = payload.data as Record<string, unknown> | undefined;
  const slugSport = data?.slugSport as Record<string, unknown> | undefined;
  const tournaments = slugSport?.firstTournament;
  const tournamentArr = Array.isArray(tournaments) ? tournaments : tournaments ? [tournaments] : [];
  const list = tournamentArr.flatMap(
    (t: Record<string, unknown>) => ((t?.fixtureList ?? []) as Array<Record<string, unknown>>),
  );
  const horizon = Date.now() + 3600_000;
  const gameId = STAKE_SPORT_SLUGS[sportSlug] || sportSlug;

  for (const fixture of list) {
    if (!["live", "active"].includes(String(fixture.status))) continue;
    const fixtureData = fixture.data as Record<string, unknown>;
    const startTime = new Date(String(fixtureData.startTime)).getTime();
    if (startTime > horizon) continue;

    const teams = (fixtureData.teams ?? []) as Array<{ qualifier?: string; name?: string }>;
    const homeTeam = teams.find((t) => t.qualifier === "home");
    const awayTeam = teams.find((t) => t.qualifier === "away");
    if (!homeTeam?.name || !awayTeam?.name) continue;

    const comps = (fixtureData.competitors ?? []) as Array<{ extId?: string; iconPath?: string }>;
    if (comps.length !== 2) continue;
    const homeComp = comps[0]!;
    const awayComp = comps[1]!;
    const homeId = homeComp.extId?.split(":").pop();
    const awayId = awayComp.extId?.split(":").pop();
    if (!homeId || !awayId) continue;

    const stageBets: CollectBetDto[] = [];
    for (const group of (fixture.groups ?? []) as Array<{ name?: string; templates?: unknown[] }>) {
      if (group.name !== "maps" && group.name !== "winner") continue;
      for (const template of (group.templates ?? []) as Array<{ markets?: unknown[] }>) {
        for (const market of (template.markets ?? []) as Array<Record<string, unknown>>) {
          const outcomes = (market.outcomes ?? []) as Array<{ id?: string; active?: boolean; odds?: number }>;
          if (outcomes.length !== 2) continue;
          const map = parseMapFromMarketName(String(market.name ?? ""));
          if (map === undefined) continue;
          const locked = market.status !== "active";
          const homeOutcome = outcomes[0]!;
          const awayOutcome = outcomes[1]!;
          const homeOdds = !locked && homeOutcome.active ? Number(homeOutcome.odds) : 0;
          const awayOdds = !locked && awayOutcome.active ? Number(awayOutcome.odds) : 0;
          stageBets.push({
            Type: PLATFORM,
            SourceMatchID: String(fixture.id),
            Map: map,
            SourceBetID: String(market.id),
            BetName: String(market.name ?? ""),
            SourceHomeID: String(homeOutcome.id),
            HomeName: homeTeam.name,
            HomeOdds: homeOdds,
            SourceAwayID: String(awayOutcome.id),
            AwayName: awayTeam.name,
            AwayOdds: awayOdds,
            Status: locked ? "Locked" : "Normal",
          });
        }
      }
    }

    const matchId = String(fixture.id);
    const mergedBets = mergeStakeBets(matchId, stageBets);
    const teamHome: CollectTeamDto = {
      Type: PLATFORM,
      TeamID: homeId,
      Name: homeTeam.name,
      GameID: gameId,
      Logo: homeComp.iconPath ?? "",
    };
    const teamAway: CollectTeamDto = {
      Type: PLATFORM,
      TeamID: awayId,
      Name: awayTeam.name,
      GameID: gameId,
      Logo: awayComp.iconPath ?? "",
    };

    const match: CollectMatchDto = {
      Type: PLATFORM,
      SourceMatchID: matchId,
      SourceGameID: gameId,
      StartTime: startTime,
      HomeID: homeId,
      Home: homeTeam.name,
      AwayID: awayId,
      Away: awayTeam.name,
      Teams: [teamHome, teamAway],
    };

    const sub: StakeSubscribeRow = { id: matchId, slug: String(fixture.slug ?? "") };
    subscribe.push(sub);
    const ingestMessage = {
      matchId,
      bets: mergedBets.map((b) => ({
        betId: String(b.SourceBetID),
        name: b.BetName,
        homeId: String(b.SourceHomeID),
        awayId: String(b.SourceAwayID),
        home: b.HomeOdds,
        away: b.AwayOdds,
      })),
    };
    // [A8 可证实] UHe：`Mi.send(Ws, o)` → 聚合回 `n2[Stake]`/`LHe`；此处本地直写 fo
    applyStakeLiveOdds(ingestMessage);
    rows.push({
      match,
      bets: mergedBets,
      subscribe: sub,
      ingestMessage,
    });
  }

  return { rows, subscribe };
}

/** 对齐 A8 `eJe` = fetch + `XZe` */
export async function collectStakeSportViaPlugin(tabId: number, sportSlug: string) {
  const payload = await fetchStakeSportIndex(tabId, sportSlug);
  return parseSportIndexResponse(sportSlug, payload);
}

export function stakeSportSlugs(): string[] {
  return Object.keys(STAKE_SPORT_SLUGS);
}
