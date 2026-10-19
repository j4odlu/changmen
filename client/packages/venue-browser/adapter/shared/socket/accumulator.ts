import { saveVenueOdds } from "@changmen/client-core/bridge/oddsAccess";
import type { CollectBetDto, CollectMatchDto } from "@changmen/client-core/types/collect";
import type { PlatformId } from "@changmen/api-contract";
import {
  formatImBetLabel,
  imBetNameIsCollectible,
  pickA8Field,
  pickImSportId,
  resolveImMapFromBet,
} from "./imBetParse";
import {
  a8StartTimeCollectAllowed,
  IM_ODDS_ACTIVE_MS,
  normalizeEpochMs,
} from "@changmen/shared/time/match_time";


export interface A8BetRow {
  betId?: string | number;
  homeId?: string | number;
  awayId?: string | number;
  home?: number;
  away?: number;
  homeName?: string;
  awayName?: string;
  matchId?: string | number;
  map?: number;
  name?: string;
  locked?: boolean;
  gameId?: string | number;
  sportId?: string | number;
}

export interface A8BetsMessage {
  matchId?: string | number;
  homeName?: string;
  awayName?: string;
  gameId?: string | number;
  bets?: A8BetRow[];
}

interface MatchAcc {
  matchId: string;
  gameId: string;
  homeId: string;
  homeName: string;
  awayId: string;
  awayName: string;
  startTime: number;
  lastSeenAt: number;
  bets: Map<string, CollectBetDto>;
}

export class A8BetsCollector {
  private matches = new Map<string, MatchAcc>();

  constructor(
    private platform: PlatformId,
    private opts: {
      homeSuffix: string;
      awaySuffix: string;
      useDirectIds?: boolean;
    },
  ) {}

  oddsIds(bet: A8BetRow) {
    if (this.opts.useDirectIds) {
      return {
        homeId: String(bet.homeId ?? ""),
        awayId: String(bet.awayId ?? ""),
        marketId: String(bet.betId ?? ""),
      };
    }
    const betId = String(bet.betId ?? "");
    return {
      homeId: `${betId}:${this.opts.homeSuffix}`,
      awayId: `${betId}:${this.opts.awaySuffix}`,
      marketId: betId,
    };
  }

  ingest(message: A8BetsMessage) {
    if (!message?.bets?.length) return;
    const defaultMatchId = message.matchId != null ? String(message.matchId) : null;

    for (const bet of message.bets) {
      const matchId = String(bet.matchId ?? defaultMatchId ?? "");
      if (!matchId) continue;

      if (this.platform === "IM") {
        const betName = pickA8Field(bet as Record<string, unknown>, "name", "Name", "betName", "BetName");
        if (betName && !imBetNameIsCollectible(betName)) continue;
      }

      const ids = this.oddsIds(bet);
      if (!ids.homeId || !ids.awayId) continue;

      const locked = Boolean(bet.locked);
      if (bet.home != null) {
        saveVenueOdds(this.platform, {
          id: ids.homeId,
          odds: Number(bet.home) || 0,
          isLock: locked,
          betId: ids.marketId,
          time: Date.now(),
        });
      }
      if (bet.away != null) {
        saveVenueOdds(this.platform, {
          id: ids.awayId,
          odds: Number(bet.away) || 0,
          isLock: locked,
          betId: ids.marketId,
          time: Date.now(),
        });
      }

      const imSportId =
        this.platform === "IM"
          ? pickImSportId(bet as Record<string, unknown>) ||
              pickImSportId(message as Record<string, unknown>)
          : "";
      const resolvedGameId =
        imSportId !== "" ? imSportId : String(bet.gameId ?? message.gameId ?? "unknown");

      const msgStart = normalizeEpochMs(
        pickA8Field(message as Record<string, unknown>, "startTime", "StartTime", "kickoff"),
      );
      const betStart = normalizeEpochMs(
        pickA8Field(bet as Record<string, unknown>, "startTime", "StartTime", "kickoff"),
      );
      const resolvedStart = msgStart || betStart || 0;

      let acc = this.matches.get(matchId);
      if (!acc) {
        acc = {
          matchId,
          gameId: resolvedGameId,
          homeId: String(bet.homeId ?? `${matchId}-home`),
          homeName: String(bet.homeName ?? message.homeName ?? "主队"),
          awayId: String(bet.awayId ?? `${matchId}-away`),
          awayName: String(bet.awayName ?? message.awayName ?? "客队"),
          startTime: resolvedStart,
          lastSeenAt: Date.now(),
          bets: new Map(),
        };
        this.matches.set(matchId, acc);
      } else if (resolvedGameId !== "unknown") {
        acc.gameId = resolvedGameId;
      }
      acc.lastSeenAt = Date.now();
      const msgHome = pickA8Field(message as Record<string, unknown>, "homeName", "HomeName");
      const msgAway = pickA8Field(message as Record<string, unknown>, "awayName", "AwayName");
      const betHome = pickA8Field(bet as Record<string, unknown>, "homeName", "HomeName");
      const betAway = pickA8Field(bet as Record<string, unknown>, "awayName", "AwayName");
      if (betHome) acc.homeName = betHome;
      if (betAway) acc.awayName = betAway;
      if (msgHome && acc.homeName === "主队") acc.homeName = msgHome;
      if (msgAway && acc.awayName === "客队") acc.awayName = msgAway;

      const rawName = pickA8Field(bet as Record<string, unknown>, "name", "Name", "betName", "BetName");
      const map =
        this.platform === "IM" ? resolveImMapFromBet({ ...bet, name: rawName }) : Number(bet.map ?? 0) || 0;
      const betKey =
        this.platform === "IM" ? `map:${map}` : ids.marketId;
      acc.bets.set(betKey, {
        Type: this.platform,
        SourceMatchID: matchId,
        SourceBetID: ids.marketId,
        Map: map,
        BetName:
          this.platform === "IM"
            ? formatImBetLabel(map, rawName)
            : rawName || `[${map === 0 ? "全场" : `地图${map}`}]-胜负`,
        SourceHomeID: ids.homeId,
        HomeName: acc.homeName,
        HomeOdds: Number(bet.home) || 0,
        SourceAwayID: ids.awayId,
        AwayName: acc.awayName,
        AwayOdds: Number(bet.away) || 0,
        Status: locked ? "Locked" : "Normal",
      });
    }
  }

  private collapseImAccs(accs: MatchAcc[]): MatchAcc[] {
    const byKey = new Map<string, MatchAcc>();
    for (const acc of accs) {
      const placeholder =
        acc.homeName === "主队" ||
        acc.awayName === "客队" ||
        !acc.homeName.trim() ||
        !acc.awayName.trim();
      const key = placeholder
        ? `ph:${acc.gameId}`
        : `${acc.homeName.trim().toLowerCase()}|${acc.awayName.trim().toLowerCase()}|${acc.gameId}`;
      const prev = byKey.get(key);
      if (!prev) {
        byKey.set(key, acc);
        continue;
      }
      if (acc.lastSeenAt > prev.lastSeenAt) {
        for (const [k, b] of prev.bets) acc.bets.set(k, b);
        byKey.set(key, acc);
      } else {
        for (const [k, b] of acc.bets) prev.bets.set(k, b);
      }
    }
    return [...byKey.values()];
  }

  buildPayload(): { matches: CollectMatchDto[]; betsByMatch: Map<string, CollectBetDto[]> } {
    const matches: CollectMatchDto[] = [];
    const betsByMatch = new Map<string, CollectBetDto[]>();

    const now = Date.now();
    let accs = [...this.matches.values()].filter((acc) => {
      if (this.platform === "IM" && now - acc.lastSeenAt > IM_ODDS_ACTIVE_MS) return false;
      if (acc.startTime > 0 && !a8StartTimeCollectAllowed(acc.startTime)) return false;
      return true;
    });
    if (this.platform === "IM") accs = this.collapseImAccs(accs);

    for (const acc of accs) {
      matches.push({
        Type: this.platform,
        SourceMatchID: acc.matchId,
        SourceGameID: acc.gameId,
        StartTime: acc.startTime,
        Home: acc.homeName,
        HomeID: acc.homeId,
        Away: acc.awayName,
        AwayID: acc.awayId,
        Teams: [
          {
            Type: this.platform,
            GameID: acc.gameId,
            Name: acc.homeName,
            TeamID: acc.homeId,
            Logo: "",
          },
          {
            Type: this.platform,
            GameID: acc.gameId,
            Name: acc.awayName,
            TeamID: acc.awayId,
            Logo: "",
          },
        ],
      });
      betsByMatch.set(acc.matchId, [...acc.bets.values()].sort((a, b) => a.Map - b.Map));
    }

    return { matches, betsByMatch };
  }

  mergeGraphqlMatch(row: {
    matchId: string;
    gameId: string;
    startTime: number;
    home: { id: string; name: string };
    away: { id: string; name: string };
    stages: Array<{
      stageId: number;
      betName: string;
      winMarketId: string;
      winHomeId: string;
      winAwayId: string;
      winHome: number | null;
      winAway: number | null;
      winLocked: boolean;
    }>;
  }) {
    let acc = this.matches.get(row.matchId);
    if (!acc) {
      acc = {
        matchId: row.matchId,
        gameId: row.gameId,
        homeId: row.home.id,
        homeName: row.home.name,
        awayId: row.away.id,
        awayName: row.away.name,
        startTime: row.startTime,
        lastSeenAt: Date.now(),
        bets: new Map(),
      };
      this.matches.set(row.matchId, acc);
    } else {
      acc.gameId = row.gameId;
      acc.homeId = row.home.id;
      acc.homeName = row.home.name;
      acc.awayId = row.away.id;
      acc.awayName = row.away.name;
      acc.startTime = row.startTime;
      acc.lastSeenAt = Date.now();
    }
    for (const stage of row.stages) {
      if (stage.winHome != null) {
        saveVenueOdds(this.platform, {
          id: stage.winHomeId,
          odds: stage.winHome,
          isLock: stage.winLocked,
          betId: stage.winMarketId,
          time: Date.now(),
        });
      }
      if (stage.winAway != null) {
        saveVenueOdds(this.platform, {
          id: stage.winAwayId,
          odds: stage.winAway,
          isLock: stage.winLocked,
          betId: stage.winMarketId,
          time: Date.now(),
        });
      }
      acc.bets.set(stage.winMarketId, {
        Type: this.platform,
        SourceMatchID: row.matchId,
        SourceBetID: stage.winMarketId,
        Map: stage.stageId,
        BetName: stage.betName,
        SourceHomeID: stage.winHomeId,
        HomeName: row.home.name,
        HomeOdds: stage.winHome ?? 0,
        SourceAwayID: stage.winAwayId,
        AwayName: row.away.name,
        AwayOdds: stage.winAway ?? 0,
        Status: stage.winLocked ? "Locked" : "Normal",
      });
    }
  }
}
