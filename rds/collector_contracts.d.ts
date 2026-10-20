// Collector-facing contracts for the existing JS DB facade. Explicitly
// referenced by typed collectors; this is not a declaration of the full DB API.
declare module "@changmen/db" {
  export interface CollectorTeam {
    Type: string;
    TeamID: string;
    Name: string;
    GameID: string;
    Logo: string;
  }
  export interface CollectorMatch {
    Type: string;
    SourceMatchID: string;
    SourceGameID: string;
    StartTime: number;
    HomeID: string;
    Home: string;
    AwayID: string;
    Away: string;
    Teams: CollectorTeam[];
  }
  export type CollectorPmSportSnapshot = import("@changmen/api-contract").PmSportSnapshot & {
    eventId?: string;
    source?: string;
  };
  export type CollectorPrematchRecord = import("@changmen/api-contract").PmPrematchTokenSnapshot;
  export interface LinkedPolymarketMatch {
    source_match_id: string;
    match_id: number;
    home: string;
    away: string;
  }
  export function hasDatabaseUrlConfig(): boolean;
  export function initDatabaseUrl(): Promise<string | null>;
  export function getResolvedDatabaseLabel(): string;
  export function writePlatformMatchesAsync(
    provider: string, matches: CollectorMatch[], opts?: { alsoKeepSourceMatchIds?: string[] },
  ): Promise<void>;
  export function replacePlatformBetsForMatchAsync(
    provider: string, matchId: string, bets: Record<string, unknown>[],
  ): Promise<void>;
  export function prunePolymarketPlatformMatches(
    opts?: { forceDeleteIds?: string[]; staleBeforeMs?: number },
  ): Promise<string[]>;
  export function ensurePmPrematchSchema(): Promise<void>;
  export function fetchPmPrematchPrices(tokenIds: string[]): Promise<Record<string, CollectorPrematchRecord>>;
  export function writePmPrematchPrices(records: CollectorPrematchRecord[]): Promise<void>;
  export function resolveClientMatchIdForPmSport(query: {
    slug?: string; gameId?: number | null; eventId?: string;
  }): Promise<number | null>;
  export function fetchPmSportByClientMatchIds(ids: number[]): Promise<Map<number, CollectorPmSportSnapshot>>;
  export function updateClientMatchPmSport(id: number, snapshot: CollectorPmSportSnapshot): Promise<boolean>;
  export function fetchLinkedPolymarketPlatformMatches(): Promise<LinkedPolymarketMatch[]>;
}
